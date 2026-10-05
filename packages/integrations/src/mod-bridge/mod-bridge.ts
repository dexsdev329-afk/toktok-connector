import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { renderTemplate, type Effect, type LiveEvent, type TemplateContext } from '@toktok/shared';
import { WebSocketServer, type WebSocket } from 'ws';
import { z } from 'zod';
import {
  IntegrationError,
  stringParam,
  type EffectDefinition,
  type Integration,
  type IntegrationDefinition,
  type IntegrationDeps,
  type IntegrationStatus,
} from '../sdk';
import { BRIDGE_PROTOCOL_VERSION, ModToAppSchema, type AppToMod, type BridgeEffectDecl } from './protocol';

export const ModBridgeConfigSchema = z.object({
  port: z.coerce.number().int().min(1024).max(65535).default(21214),
  /** Shared secret the mod sends in "hello" (copied into the mod config). */
  token: z.string().min(8).max(200),
  resultTimeoutMs: z.coerce.number().int().min(500).max(60_000).default(5000),
});
export type ModBridgeConfig = z.infer<typeof ModBridgeConfigSchema>;

interface ModSession {
  ws: WebSocket;
  modId: string;
  name: string;
  effects: BridgeEffectDecl[];
  subscriptions: Set<string>;
}

interface PendingResult {
  resolve: () => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Effect id exposed to the action editor for a declared mod effect. */
export const modEffectId = (modId: string, effectId: string) => `mod:${modId}:${effectId}`;

/**
 * Generic local WebSocket bridge any game mod can join (BepInEx, MelonLoader, Lua...).
 * Mods declare their effects in "hello"; they then appear in the action editor.
 */
export class ModBridgeIntegration implements Integration {
  readonly autoStart = true;
  private wss: WebSocketServer | null = null;
  private readonly sessions = new Map<WebSocket, ModSession>();
  private readonly pending = new Map<string, PendingResult>();
  private state: IntegrationStatus = { state: 'disconnected' };

  constructor(
    private readonly config: ModBridgeConfig,
    private readonly deps: IntegrationDeps,
  ) {}

  get port(): number {
    const addr = this.wss?.address();
    return typeof addr === 'object' && addr ? addr.port : this.config.port;
  }

  status(): IntegrationStatus {
    return this.state;
  }

  /** Static generic effect + every effect declared by connected mods. */
  listEffects(): EffectDefinition[] {
    const dynamic: EffectDefinition[] = [];
    for (const s of this.sessions.values()) {
      for (const e of s.effects) {
        dynamic.push({
          id: modEffectId(s.modId, e.id),
          name: `${s.name} — ${e.name}`,
          ...(e.description ? { description: e.description } : {}),
          params: Object.entries(e.params).map(([key, p]) => ({
            key,
            label: p.label ?? key,
            type:
              p.type === 'bool'
                ? ('boolean' as const)
                : p.type === 'string'
                  ? ('string' as const)
                  : ('number' as const),
            ...(p.default !== undefined ? { default: p.default } : {}),
            ...(p.min !== undefined ? { min: p.min } : {}),
            ...(p.max !== undefined ? { max: p.max } : {}),
          })),
        });
      }
    }
    return [...modBridgeDefinition.effects, ...dynamic];
  }

  async connect(): Promise<void> {
    if (this.wss) return;
    const wss = new WebSocketServer({
      host: '127.0.0.1',
      port: this.config.port,
      maxPayload: 256 * 1024,
      // Mods never send an Origin header; browsers always do.
      verifyClient: (info: { req: IncomingMessage }) => !info.req.headers.origin,
    });
    await new Promise<void>((resolve, reject) => {
      wss.once('listening', resolve);
      wss.once('error', reject);
    }).catch((err: unknown) => {
      wss.close();
      const msg = err instanceof Error ? err.message : String(err);
      this.state = { state: 'error', detail: msg };
      throw new IntegrationError(`Port ${this.config.port} indisponible : ${msg}`);
    });
    this.wss = wss;
    this.updateState();
    wss.on('connection', (ws) => this.onConnection(ws));
  }

  async disconnect(): Promise<void> {
    for (const [id, p] of [...this.pending]) {
      clearTimeout(p.timer);
      this.pending.delete(id);
      p.reject(new IntegrationError('Bridge arrêté'));
    }
    const wss = this.wss;
    this.wss = null;
    this.sessions.clear();
    if (wss) {
      for (const c of wss.clients) c.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    }
    this.state = { state: 'disconnected' };
  }

  onLiveEvent(event: LiveEvent): void {
    const data = JSON.stringify({ type: 'event', event } satisfies AppToMod);
    for (const s of this.sessions.values()) {
      if (s.subscriptions.has(event.type) && s.ws.readyState === s.ws.OPEN) s.ws.send(data);
    }
  }

  async execute(effect: Effect, ctx: TemplateContext, signal: AbortSignal): Promise<void> {
    let modId: string;
    let effectName: string;
    let params: Record<string, unknown>;
    if (effect.effectId === 'bridge.send') {
      modId = stringParam(effect, 'mod');
      effectName = stringParam(effect, 'effect');
      const raw = stringParam(effect, 'params').trim();
      try {
        params = raw ? (JSON.parse(renderTemplate(raw, ctx, 'json')) as Record<string, unknown>) : {};
      } catch {
        throw new IntegrationError('Paramètres JSON invalides');
      }
    } else if (effect.effectId.startsWith('mod:')) {
      const [, m, e] = effect.effectId.split(':');
      modId = m ?? '';
      effectName = e ?? '';
      params = Object.fromEntries(
        Object.entries(effect.params).map(([k, v]) => [
          k,
          typeof v === 'string' ? renderTemplate(v, ctx) : v,
        ]),
      );
    } else {
      throw new IntegrationError(`Effet inconnu: ${effect.effectId}`);
    }

    const session = [...this.sessions.values()].find((s) => s.modId === modId);
    if (!session) throw new IntegrationError(`Mod « ${modId} » non connecté`);
    const id = randomUUID();
    const done = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new IntegrationError(`Pas de réponse du mod « ${modId} »`));
      }, this.config.resultTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(new IntegrationError('annulé'));
        },
        { once: true },
      );
    });
    this.send(session.ws, { type: 'effect', id, effect: effectName, params, context: { ...ctx } });
    await done;
  }

  private onConnection(ws: WebSocket): void {
    // The mod must authenticate within 5 s.
    const helloTimer = setTimeout(() => ws.close(4001, 'hello timeout'), 5000);
    ws.on('message', (data) => {
      let msg;
      try {
        msg = ModToAppSchema.parse(JSON.parse(String(data)));
      } catch {
        this.send(ws, { type: 'error', message: 'message invalide' });
        return;
      }
      const session = this.sessions.get(ws);
      if (!session) {
        if (msg.type !== 'hello') return void ws.close(4002, 'hello expected');
        clearTimeout(helloTimer);
        if (!safeEqual(msg.token, this.config.token)) {
          this.send(ws, { type: 'error', message: 'jeton invalide' });
          return void ws.close(4003, 'bad token');
        }
        // One session per mod id: a reconnecting mod replaces its previous session.
        for (const [other, s] of this.sessions) if (s.modId === msg.mod.id) other.close(4004, 'replaced');
        this.sessions.set(ws, {
          ws,
          modId: msg.mod.id,
          name: msg.mod.name,
          effects: msg.effects,
          subscriptions: new Set(),
        });
        this.send(ws, { type: 'welcome', protocol: BRIDGE_PROTOCOL_VERSION, sessionId: randomUUID() });
        this.deps.log('info', `Mod connecté : ${msg.mod.name} (${msg.effects.length} effets)`);
        this.updateState();
        return;
      }
      switch (msg.type) {
        case 'result': {
          const p = this.pending.get(msg.id);
          if (!p) return;
          clearTimeout(p.timer);
          this.pending.delete(msg.id);
          if (msg.status === 'ok') p.resolve();
          else
            p.reject(
              new IntegrationError(
                `${session.name} : ${msg.status === 'busy' ? 'occupé' : (msg.message ?? 'erreur')}`,
              ),
            );
          return;
        }
        case 'subscribe':
          session.subscriptions = new Set(msg.events);
          return;
        case 'ping':
          this.send(ws, { type: 'pong' });
          return;
        case 'hello':
          return;
      }
    });
    ws.on('close', () => {
      clearTimeout(helloTimer);
      const s = this.sessions.get(ws);
      if (s) {
        this.sessions.delete(ws);
        this.deps.log('info', `Mod déconnecté : ${s.name}`);
        this.updateState();
      }
    });
    ws.on('error', () => ws.terminate());
  }

  private send(ws: WebSocket, msg: AppToMod): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  private updateState(): void {
    const names = [...this.sessions.values()].map((s) => s.name);
    this.state = names.length
      ? { state: 'connected', detail: `Mods : ${names.join(', ')}` }
      : { state: 'connecting', detail: `En attente d’un mod sur ws://127.0.0.1:${this.port}` };
    this.deps.statusChanged?.();
  }
}

export const modBridgeDefinition: IntegrationDefinition<ModBridgeConfig> = {
  kind: 'mod-bridge',
  name: 'Bridge mods (WebSocket)',
  description:
    'Serveur local auquel n’importe quel mod se connecte (BepInEx, MelonLoader, Lua…). Voir docs/bridge-protocol.md.',
  configFields: [
    { key: 'port', label: 'integrations.bridge.port', type: 'number', default: 21214, min: 1024, max: 65535 },
    {
      key: 'token',
      label: 'integrations.bridge.token',
      type: 'string',
      help: 'integrations.bridge.tokenHelp',
      autoGenerate: 'token',
    },
  ],
  configSchema: ModBridgeConfigSchema,
  effects: [
    {
      id: 'bridge.send',
      name: 'Effet de mod (manuel)',
      description: 'Envoie un effet à un mod par son id, avec des paramètres JSON (variables autorisées).',
      params: [
        { key: 'mod', label: 'bridge.mod', type: 'string', placeholder: 'my-unity-mod' },
        { key: 'effect', label: 'bridge.effect', type: 'string', placeholder: 'spawn_enemy' },
        {
          key: 'params',
          label: 'bridge.params',
          type: 'text',
          placeholder: '{"count": {count}, "by": "{username}"}',
        },
      ],
    },
  ],
  create: (config, deps) => new ModBridgeIntegration(config, deps),
};
