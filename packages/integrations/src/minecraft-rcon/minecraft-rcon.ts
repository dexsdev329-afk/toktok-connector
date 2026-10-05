import { renderTemplate, type Effect, type TemplateContext } from '@toktok/shared';
import { z } from 'zod';
import {
  IntegrationError,
  stringParam,
  type EffectPreset,
  type Integration,
  type IntegrationDefinition,
  type IntegrationDeps,
  type IntegrationStatus,
} from '../sdk';

export const RconConfigSchema = z.object({
  host: z.string().min(1).max(255).default('127.0.0.1'),
  port: z.coerce.number().int().min(1).max(65535).default(25575),
  password: z.string().max(512).default(''),
  /** Minecraft name of the streamer, available as {player}. */
  player: z
    .string()
    .max(16)
    .regex(/^[A-Za-z0-9_]*$/)
    .default(''),
  timeoutMs: z.coerce.number().int().min(500).max(30_000).default(3000),
});
export type RconConfig = z.infer<typeof RconConfigSchema>;

/** Minimal surface of rcon-client used here (injectable for tests). */
export interface RconClient {
  send(command: string): Promise<string>;
  end(): Promise<void>;
  on(event: 'end' | 'error', listener: (...args: unknown[]) => void): unknown;
}
export type RconFactory = (cfg: {
  host: string;
  port: number;
  password: string;
  timeout: number;
}) => Promise<RconClient>;

const defaultFactory: RconFactory = async (cfg) => {
  const { Rcon } = await import('rcon-client');
  return (await Rcon.connect(cfg)) as unknown as RconClient;
};

/** Target used in presets: the configured player, or every player. */
const P = '{player}';

export const RCON_PRESETS: EffectPreset[] = [
  // Mobs
  {
    id: 'mc.zombie',
    name: 'Zombie',
    category: 'mobs',
    effectId: 'rcon.command',
    params: {
      command: `execute at ${P} run summon zombie ~ ~ ~2 {CustomName:'"{username}"',CustomNameVisible:1b}`,
    },
  },
  {
    id: 'mc.creeper',
    name: 'Creeper',
    category: 'mobs',
    effectId: 'rcon.command',
    params: {
      command: `execute at ${P} run summon creeper ~ ~ ~3 {CustomName:'"{username}"',CustomNameVisible:1b}`,
    },
  },
  {
    id: 'mc.skeleton',
    name: 'Squelette',
    category: 'mobs',
    effectId: 'rcon.command',
    params: {
      command: `execute at ${P} run summon skeleton ~ ~ ~3 {CustomName:'"{username}"',CustomNameVisible:1b}`,
    },
  },
  {
    id: 'mc.wolf',
    name: 'Loup apprivoisé (aide)',
    category: 'mobs',
    effectId: 'rcon.command',
    params: {
      command: `execute at ${P} run summon wolf ~ ~ ~1 {CustomName:'"{username}"',CustomNameVisible:1b}`,
    },
  },
  {
    id: 'mc.chicken-rain',
    name: 'Pluie de poulets',
    category: 'mobs',
    effectId: 'rcon.command',
    params: { command: `execute at ${P} run summon chicken ~ ~10 ~` },
  },
  // TNT
  {
    id: 'mc.tnt',
    name: 'TNT',
    category: 'tnt',
    effectId: 'rcon.command',
    params: { command: `execute at ${P} run summon tnt ~ ~3 ~ {fuse:60}` },
  },
  {
    id: 'mc.tnt-fast',
    name: 'TNT (mèche courte)',
    category: 'tnt',
    effectId: 'rcon.command',
    params: { command: `execute at ${P} run summon tnt ~ ~1 ~ {fuse:20}` },
  },
  // Potion effects
  {
    id: 'mc.speed',
    name: 'Vitesse 30s',
    category: 'effects',
    effectId: 'rcon.command',
    params: { command: `effect give ${P} minecraft:speed 30 2` },
  },
  {
    id: 'mc.slowness',
    name: 'Lenteur 20s',
    category: 'effects',
    effectId: 'rcon.command',
    params: { command: `effect give ${P} minecraft:slowness 20 2` },
  },
  {
    id: 'mc.blindness',
    name: 'Cécité 10s',
    category: 'effects',
    effectId: 'rcon.command',
    params: { command: `effect give ${P} minecraft:blindness 10 0` },
  },
  {
    id: 'mc.levitation',
    name: 'Lévitation 5s',
    category: 'effects',
    effectId: 'rcon.command',
    params: { command: `effect give ${P} minecraft:levitation 5 1` },
  },
  {
    id: 'mc.regeneration',
    name: 'Régénération 15s',
    category: 'effects',
    effectId: 'rcon.command',
    params: { command: `effect give ${P} minecraft:regeneration 15 1` },
  },
  {
    id: 'mc.heal',
    name: 'Soin complet',
    category: 'effects',
    effectId: 'rcon.command',
    params: { command: `effect give ${P} minecraft:instant_health 1 4` },
  },
  // Weather / time
  {
    id: 'mc.rain',
    name: 'Pluie',
    category: 'world',
    effectId: 'rcon.command',
    params: { command: 'weather rain 600' },
  },
  {
    id: 'mc.thunder',
    name: 'Orage',
    category: 'world',
    effectId: 'rcon.command',
    params: { command: 'weather thunder 600' },
  },
  {
    id: 'mc.clear',
    name: 'Beau temps',
    category: 'world',
    effectId: 'rcon.command',
    params: { command: 'weather clear 600' },
  },
  {
    id: 'mc.night',
    name: 'Nuit',
    category: 'world',
    effectId: 'rcon.command',
    params: { command: 'time set night' },
  },
  {
    id: 'mc.day',
    name: 'Jour',
    category: 'world',
    effectId: 'rcon.command',
    params: { command: 'time set day' },
  },
  {
    id: 'mc.lightning',
    name: 'Éclair',
    category: 'world',
    effectId: 'rcon.command',
    params: { command: `execute at ${P} run summon lightning_bolt ~2 ~ ~2` },
  },
  // Titles / messages
  {
    id: 'mc.title-gift',
    name: 'Titre : merci pour le cadeau',
    category: 'titles',
    effectId: 'rcon.command',
    params: {
      command: `title ${P} title {"text":"{displayName}","color":"gold"}\ntitle ${P} subtitle {"text":"{count}x {giftName}","color":"yellow"}`,
    },
  },
  {
    id: 'mc.title-follow',
    name: 'Titre : nouvel abonné',
    category: 'titles',
    effectId: 'rcon.command',
    params: { command: `title ${P} actionbar {"text":"{displayName} suit le live !","color":"aqua"}` },
  },
  {
    id: 'mc.say',
    name: 'Message dans le chat',
    category: 'titles',
    effectId: 'rcon.command',
    params: { command: 'tellraw @a {"text":"[LIVE] {displayName}: {message}","color":"light_purple"}' },
  },
  // Items
  {
    id: 'mc.diamond',
    name: 'Donner un diamant',
    category: 'items',
    effectId: 'rcon.command',
    params: { command: `give ${P} minecraft:diamond {count}` },
  },
  {
    id: 'mc.golden-apple',
    name: 'Pomme dorée',
    category: 'items',
    effectId: 'rcon.command',
    params: { command: `give ${P} minecraft:golden_apple 1` },
  },
];

/** Renders a (multi-line) command template into individual safe commands. */
export function renderRconCommands(template: string, ctx: TemplateContext, player: string): string[] {
  const target = player || '@a';
  return template
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => renderTemplate(line.replaceAll('{player}', target), ctx, 'minecraft'))
    .map((line) => line.replace(/^\//, ''))
    .slice(0, 20);
}

export class MinecraftRconIntegration implements Integration {
  private client: RconClient | null = null;
  private connecting: Promise<RconClient> | null = null;
  private state: IntegrationStatus = { state: 'disconnected' };

  constructor(
    private readonly config: RconConfig,
    private readonly deps: IntegrationDeps,
    private readonly factory: RconFactory = defaultFactory,
  ) {}

  status(): IntegrationStatus {
    return this.state;
  }

  listEffects() {
    return minecraftRconDefinition.effects;
  }

  async connect(): Promise<void> {
    await this.ensureClient();
  }

  async disconnect(): Promise<void> {
    const c = this.client;
    this.client = null;
    this.connecting = null;
    this.state = { state: 'disconnected' };
    if (c) await c.end().catch(() => undefined);
  }

  async execute(effect: Effect, ctx: TemplateContext, signal: AbortSignal): Promise<void> {
    if (effect.effectId !== 'rcon.command') throw new IntegrationError(`Effet inconnu: ${effect.effectId}`);
    const commands = renderRconCommands(stringParam(effect, 'command'), ctx, this.config.player);
    for (const cmd of commands) {
      if (signal.aborted) return;
      const client = await this.ensureClient();
      try {
        const res = await client.send(cmd);
        if (/^(Unknown|Incorrect|Invalid|Expected)/i.test(res))
          this.deps.log('warn', `RCON: ${cmd} -> ${res}`);
      } catch (err) {
        // The socket may have died: drop it so the next command reconnects.
        await this.disconnect();
        this.state = { state: 'error', detail: err instanceof Error ? err.message : String(err) };
        throw err;
      }
    }
  }

  private async ensureClient(): Promise<RconClient> {
    if (this.client) return this.client;
    if (!this.connecting) {
      this.state = { state: 'connecting' };
      this.connecting = this.factory({
        host: this.config.host,
        port: this.config.port,
        password: this.config.password,
        timeout: this.config.timeoutMs,
      })
        .then((client) => {
          this.client = client;
          this.state = { state: 'connected' };
          client.on('end', () => {
            if (this.client === client) {
              this.client = null;
              this.connecting = null;
              this.state = { state: 'disconnected', detail: 'Connexion fermée par le serveur' };
            }
          });
          client.on('error', () => undefined);
          return client;
        })
        .catch((err: unknown) => {
          this.connecting = null;
          const msg = err instanceof Error ? err.message : String(err);
          this.state = { state: 'error', detail: msg };
          throw new IntegrationError(
            `Connexion RCON impossible (${this.config.host}:${this.config.port}) : ${msg}`,
          );
        });
    }
    return this.connecting;
  }
}

export const minecraftRconDefinition: IntegrationDefinition<RconConfig> = {
  kind: 'minecraft-rcon',
  name: 'Minecraft Java (RCON)',
  description:
    'Envoie des commandes à un serveur Minecraft Java via RCON (enable-rcon=true dans server.properties).',
  configFields: [
    { key: 'host', label: 'integrations.rcon.host', type: 'string', default: '127.0.0.1' },
    { key: 'port', label: 'integrations.rcon.port', type: 'number', default: 25575, min: 1, max: 65535 },
    { key: 'password', label: 'integrations.rcon.password', type: 'password', secret: true },
    {
      key: 'player',
      label: 'integrations.rcon.player',
      type: 'string',
      help: 'integrations.rcon.playerHelp',
    },
  ],
  configSchema: RconConfigSchema,
  effects: [
    {
      id: 'rcon.command',
      name: 'Commande Minecraft',
      description:
        'Une commande par ligne. Variables : {player} {username} {displayName} {giftName} {count} {diamonds} {message}',
      params: [
        { key: 'command', label: 'effects.command', type: 'text', placeholder: 'say Merci {displayName} !' },
      ],
    },
  ],
  presets: RCON_PRESETS,
  create: (config, deps) => new MinecraftRconIntegration(config, deps),
};
