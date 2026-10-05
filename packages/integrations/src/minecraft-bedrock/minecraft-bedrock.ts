/**
 * Minecraft Bedrock via the in-game WebSocket client (/connect localhost:PORT, cheats enabled).
 *
 * The game is the WebSocket client and this integration is the server. Messages are JSON:
 *   -> {header:{version:1,requestId,messagePurpose:"commandRequest",messageType:"commandRequest"},
 *       body:{version:1,commandLine,origin:{type:"player"}}}
 *   <- {header:{messagePurpose:"commandResponse",requestId}, body:{statusCode,statusMessage}}
 *   -> {header:{...,messagePurpose:"subscribe"}, body:{eventName:"PlayerMessage"}}
 *   <- {header:{messagePurpose:"event",eventName}, body:{...}}
 * Not documented by Microsoft; matches the Minecraft Wiki and open-source servers (e.g. sandertv/mcwss).
 * Encrypted WebSockets (enableencryption) are not supported yet: the player must disable
 * "Require Encrypted Websockets" in the game settings.
 */
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Effect, TemplateContext } from '@toktok/shared';
import { WebSocketServer, type WebSocket } from 'ws';
import { z } from 'zod';
import {
  MINECRAFT_EFFECTS,
  MINECRAFT_PRESETS,
  buildMinecraftCommands,
  rawCommandEffect,
  renderCommandTemplate,
} from '../minecraft/commands';
import {
  IntegrationError,
  stringParam,
  type Integration,
  type IntegrationDefinition,
  type IntegrationDeps,
  type IntegrationStatus,
} from '../sdk';

export const BedrockConfigSchema = z.object({
  port: z.coerce.number().int().min(1024).max(65535).default(19135),
  /** Bedrock gamertag of the streamer; empty = the player who typed /connect (@s). */
  player: z.string().max(32).default(''),
  /** Forward in-game chat to the app log. */
  logChat: z.boolean().default(false),
  commandTimeoutMs: z.coerce.number().int().min(500).max(30_000).default(5000),
});
export type BedrockConfig = z.infer<typeof BedrockConfigSchema>;

/** Bedrock drops requests beyond ~100 outstanding commands: stay well below. */
const MAX_IN_FLIGHT = 40;

interface Pending {
  resolve: (body: { statusCode?: number; statusMessage?: string }) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class MinecraftBedrockIntegration implements Integration {
  readonly autoStart = true;
  private wss: WebSocketServer | null = null;
  private game: WebSocket | null = null;
  private readonly pending = new Map<string, Pending>();
  private readonly waiters: (() => void)[] = [];
  private state: IntegrationStatus = { state: 'disconnected' };

  constructor(
    private readonly config: BedrockConfig,
    private readonly deps: IntegrationDeps,
    private readonly random: () => number = Math.random,
  ) {}

  status(): IntegrationStatus {
    return this.state;
  }

  listEffects() {
    return minecraftBedrockDefinition.effects;
  }

  get port(): number {
    const addr = this.wss?.address();
    return typeof addr === 'object' && addr ? addr.port : this.config.port;
  }

  /** Starts the local server and waits for the game to connect. */
  async connect(): Promise<void> {
    if (this.wss) return;
    const wss = new WebSocketServer({
      host: '127.0.0.1',
      port: this.config.port,
      maxPayload: 1024 * 1024,
      // The game never sends an Origin header; browsers always do. Rejecting it prevents
      // any web page from talking to this socket.
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
    this.waitingStatus();
    wss.on('connection', (ws) => this.onGame(ws));
  }

  async disconnect(): Promise<void> {
    this.failPending(new IntegrationError('Déconnecté'));
    this.game?.close();
    this.game = null;
    const wss = this.wss;
    this.wss = null;
    if (wss) {
      for (const c of wss.clients) c.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    }
    this.state = { state: 'disconnected' };
  }

  commandsFor(effect: Effect, ctx: TemplateContext): string[] {
    if (effect.effectId === 'bedrock.command') {
      return renderCommandTemplate(stringParam(effect, 'command'), ctx, this.config.player, 'bedrock');
    }
    const cmds = buildMinecraftCommands(effect, ctx, {
      edition: 'bedrock',
      player: this.config.player,
      random: this.random,
    });
    if (!cmds) throw new IntegrationError(`Effet inconnu: ${effect.effectId}`);
    return cmds;
  }

  async execute(effect: Effect, ctx: TemplateContext, signal: AbortSignal): Promise<void> {
    const commands = this.commandsFor(effect, ctx);
    for (const cmd of commands) {
      if (signal.aborted) return;
      const body = await this.send(cmd);
      if (body.statusCode !== undefined && body.statusCode !== 0) {
        this.deps.log('warn', `Minecraft : « ${cmd} » → ${body.statusMessage ?? body.statusCode}`);
      }
    }
  }

  /** Sends one command and resolves with the game's response body. */
  async send(commandLine: string): Promise<{ statusCode?: number; statusMessage?: string }> {
    const game = this.game;
    if (!game || game.readyState !== game.OPEN) {
      throw new IntegrationError(
        `Minecraft n’est pas connecté : tape /connect localhost:${this.port} dans le jeu`,
      );
    }
    while (this.pending.size >= MAX_IN_FLIGHT) await new Promise<void>((r) => this.waiters.push(r));
    const requestId = randomUUID();
    const result = new Promise<{ statusCode?: number; statusMessage?: string }>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.settle(requestId);
        reject(new IntegrationError(`Pas de réponse de Minecraft pour « ${commandLine} »`));
      }, this.config.commandTimeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
    });
    game.send(
      JSON.stringify({
        header: { version: 1, requestId, messagePurpose: 'commandRequest', messageType: 'commandRequest' },
        body: { version: 1, commandLine, origin: { type: 'player' } },
      }),
    );
    return result;
  }

  private onGame(ws: WebSocket): void {
    // A new /connect replaces the previous game session.
    if (this.game && this.game !== ws) this.game.close();
    this.game = ws;
    this.state = { state: 'connected', detail: 'Minecraft connecté' };
    this.deps.statusChanged?.();
    ws.on('message', (data) => this.onMessage(data.toString()));
    ws.on('close', () => {
      if (this.game !== ws) return;
      this.game = null;
      this.failPending(new IntegrationError('Minecraft s’est déconnecté'));
      this.waitingStatus();
      this.deps.statusChanged?.();
    });
    ws.on('error', () => ws.terminate());
    if (this.config.logChat) this.subscribe('PlayerMessage');
    void this.send('title @s actionbar TokTok Game Connector Live : connecté').catch(() => undefined);
  }

  private subscribe(eventName: string): void {
    this.game?.send(
      JSON.stringify({
        header: {
          version: 1,
          requestId: randomUUID(),
          messagePurpose: 'subscribe',
          messageType: 'commandRequest',
        },
        body: { eventName },
      }),
    );
  }

  private onMessage(raw: string): void {
    let msg: {
      header?: { requestId?: string; messagePurpose?: string; eventName?: string };
      body?: Record<string, unknown>;
    };
    try {
      msg = JSON.parse(raw) as typeof msg;
    } catch {
      return;
    }
    const purpose = msg.header?.messagePurpose;
    const id = msg.header?.requestId;
    if ((purpose === 'commandResponse' || purpose === 'error') && id) {
      const p = this.pending.get(id);
      if (!p) return;
      this.settle(id);
      const body = (msg.body ?? {}) as { statusCode?: number; statusMessage?: string };
      if (purpose === 'error') p.reject(new IntegrationError(body.statusMessage ?? 'Erreur Minecraft'));
      else p.resolve(body);
    } else if (purpose === 'event' && msg.header?.eventName === 'PlayerMessage' && this.config.logChat) {
      const b = msg.body ?? {};
      if (b.type === 'chat' && typeof b.message === 'string') {
        this.deps.log('info', `[Minecraft] ${String(b.sender ?? '?')} : ${b.message.slice(0, 200)}`);
      }
    }
  }

  private settle(requestId: string): void {
    const p = this.pending.get(requestId);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(requestId);
    this.waiters.shift()?.();
  }

  private failPending(err: Error): void {
    for (const [id, p] of [...this.pending]) {
      this.settle(id);
      p.reject(err);
    }
  }

  private waitingStatus(): void {
    this.state = {
      state: 'connecting',
      detail: `En attente : tape /connect localhost:${this.port} dans Minecraft`,
    };
  }
}

export const minecraftBedrockDefinition: IntegrationDefinition<BedrockConfig> = {
  kind: 'minecraft-bedrock',
  name: 'Minecraft Bedrock (/connect)',
  description:
    'Minecraft Bedrock (Windows, consoles en local) se connecte à l’app avec /connect localhost:PORT. Triche activée, et « Websockets chiffrés obligatoires » désactivé.',
  configFields: [
    {
      key: 'port',
      label: 'integrations.bedrock.port',
      type: 'number',
      default: 19135,
      min: 1024,
      max: 65535,
    },
    {
      key: 'player',
      label: 'integrations.bedrock.player',
      type: 'string',
      help: 'integrations.bedrock.playerHelp',
    },
    { key: 'logChat', label: 'integrations.bedrock.logChat', type: 'boolean', default: false },
  ],
  configSchema: BedrockConfigSchema,
  effects: [...MINECRAFT_EFFECTS, rawCommandEffect('bedrock.command')],
  presets: MINECRAFT_PRESETS,
  create: (config, deps) => new MinecraftBedrockIntegration(config, deps),
};
