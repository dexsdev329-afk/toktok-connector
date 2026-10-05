import type { Effect } from '@toktok/shared';
import WebSocket from 'ws';
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

/**
 * GTA V Chaos Mod (gta-chaos-mod, GPL-3.0) "Debug WebSocket". Only the public message format is
 * used (checked in the mod's sources, May 2026): the mod listens on ws://127.0.0.1:31819 when the
 * file `chaosmod/.enabledebugsocket` exists in the GTA V folder.
 *   -> {"command":"fetch_effects"}           <- {"command":"result_fetch_effects","effects":[{id,name}]}
 *   -> {"command":"trigger_effect","effect_id":"..."}   (no answer; ignored if the effect is disabled)
 * The socket can also run raw Lua scripts ("exec_script"): deliberately NOT exposed.
 */
export const ChaosModConfigSchema = z.object({
  port: z.coerce.number().int().min(1024).max(65535).default(31819),
});
export type ChaosModConfig = z.infer<typeof ChaosModConfigSchema>;

export interface ChaosEffectInfo {
  id: string;
  name: string;
}

export function parseChaosEffects(raw: unknown): ChaosEffectInfo[] | null {
  if (!raw || typeof raw !== 'object') return null;
  const msg = raw as { command?: unknown; effects?: unknown };
  if (msg.command !== 'result_fetch_effects' || !Array.isArray(msg.effects)) return null;
  const out: ChaosEffectInfo[] = [];
  for (const e of msg.effects as { id?: unknown; name?: unknown }[]) {
    if (typeof e?.id !== 'string' || !e.id || e.id.length > 200) continue;
    out.push({ id: e.id, name: typeof e.name === 'string' && e.name ? e.name.slice(0, 120) : e.id });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

type SocketFactory = (url: string) => WebSocket;

const RETRY_MS = 5000;

export class ChaosModIntegration implements Integration {
  readonly autoStart = true;
  private ws: WebSocket | null = null;
  private wanted = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private state: IntegrationStatus = { state: 'disconnected' };
  private effects: ChaosEffectInfo[] = [];

  constructor(
    private readonly config: ChaosModConfig,
    private readonly deps: IntegrationDeps,
    private readonly factory: SocketFactory = (url) => new WebSocket(url, { handshakeTimeout: 3000 }),
    private readonly random: () => number = Math.random,
  ) {}

  status(): IntegrationStatus {
    return this.state;
  }

  /** Effects of this instance: the trigger effect lists the mod's effects once connected. */
  listEffects(): EffectDefinition[] {
    const list = this.effects;
    return [
      {
        ...TRIGGER,
        params: [
          list.length
            ? {
                key: 'effect',
                label: 'chaos.effect',
                type: 'select',
                default: list[0]!.id,
                options: list.map((e) => ({ value: e.id, label: e.name })),
              }
            : { key: 'effect', label: 'chaos.effect', type: 'string', placeholder: 'player_suicide' },
        ],
      },
      RANDOM,
    ];
  }

  async connect(): Promise<void> {
    if (this.wanted) return;
    this.wanted = true;
    this.open();
  }

  async disconnect(): Promise<void> {
    this.wanted = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const ws = this.ws;
    this.ws = null;
    ws?.removeAllListeners();
    ws?.on('error', () => undefined);
    ws?.close();
    this.state = { state: 'disconnected' };
  }

  async execute(effect: Effect): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new IntegrationError('GTA V / Chaos Mod non connecté');
    }
    let id: string;
    if (effect.effectId === RANDOM.id) {
      if (!this.effects.length) throw new IntegrationError('Liste des effets Chaos pas encore reçue');
      id = this.effects[Math.floor(this.random() * this.effects.length)]!.id;
    } else if (effect.effectId === TRIGGER.id) {
      id = stringParam(effect, 'effect').trim();
      if (!id) throw new IntegrationError('Effet Chaos manquant');
      if (this.effects.length && !this.effects.some((e) => e.id === id)) {
        throw new IntegrationError(`Effet Chaos inconnu ou désactivé : ${id}`);
      }
    } else {
      throw new IntegrationError(`Effet inconnu : ${effect.effectId}`);
    }
    this.ws.send(JSON.stringify({ command: 'trigger_effect', effect_id: id }));
  }

  private open(): void {
    if (!this.wanted) return;
    const ws = this.factory(`ws://127.0.0.1:${this.config.port}`);
    this.ws = ws;
    ws.on('open', () => {
      this.state = { state: 'connected', detail: 'Chaos Mod connecté' };
      this.deps.statusChanged?.();
      ws.send(JSON.stringify({ command: 'fetch_effects' }));
    });
    ws.on('message', (data) => {
      let msg: unknown;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      const effects = parseChaosEffects(msg);
      if (effects) {
        this.effects = effects;
        this.state = { state: 'connected', detail: `${effects.length} effets Chaos disponibles` };
        this.deps.statusChanged?.();
      }
    });
    ws.on('close', () => {
      if (this.ws === ws) this.ws = null;
      if (!this.wanted) return;
      const was = this.state.state;
      this.state = { state: 'connecting', detail: 'En attente de GTA V (Chaos Mod, debug socket activé)…' };
      if (was !== 'connecting') this.deps.statusChanged?.();
      this.timer = setTimeout(() => this.open(), RETRY_MS);
    });
    // Connection refused while the game is closed: the close handler retries.
    ws.on('error', () => undefined);
  }
}

const TRIGGER: EffectDefinition = {
  id: 'chaos.trigger',
  name: 'Déclencher un effet Chaos',
  description: 'La liste des effets se remplit quand GTA V est lancé avec le Chaos Mod.',
  params: [],
};
const RANDOM: EffectDefinition = {
  id: 'chaos.random',
  name: 'Effet Chaos aléatoire',
  description: 'Un effet au hasard parmi ceux activés dans la configuration du Chaos Mod.',
  params: [],
};

export const chaosModDefinition: IntegrationDefinition<ChaosModConfig> = {
  kind: 'chaos-mod',
  name: 'GTA V Chaos Mod (expérimental)',
  description:
    'Déclenche les effets du Chaos Mod (GTA V solo) via son WebSocket de debug local. Crée le fichier chaosmod/.enabledebugsocket dans le dossier de GTA V.',
  configFields: [{ key: 'port', label: 'chaos.port', type: 'number', default: 31819, min: 1024, max: 65535 }],
  configSchema: ChaosModConfigSchema,
  effects: [TRIGGER, RANDOM],
  create: (config, deps) => new ChaosModIntegration(config, deps),
};
