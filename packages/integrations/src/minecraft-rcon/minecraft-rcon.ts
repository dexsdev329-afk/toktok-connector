import type { Effect, TemplateContext } from '@toktok/shared';
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
  /** 1.21.5+ writes text components in SNBT; older versions use JSON strings. */
  version: z.enum(['java', 'java-legacy']).default('java'),
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

/** Raw command examples, on top of the structured presets. */
export const RCON_PRESETS: EffectPreset[] = [
  ...MINECRAFT_PRESETS,
  {
    id: 'mc.raw.title-chat',
    name: 'Commande libre : titre + son',
    category: 'Commandes libres',
    effectId: 'rcon.command',
    params: {
      command:
        'title {player} actionbar {"text":"{displayName} : {count}x {giftName}","color":"gold"}\nexecute at {player} run playsound minecraft:entity.player.levelup master {player}',
    },
  },
  {
    id: 'mc.raw.anvil',
    name: 'Commande libre : enclume au-dessus',
    category: 'Commandes libres',
    effectId: 'rcon.command',
    params: { command: 'execute at {player} run setblock ~ ~6 ~ minecraft:anvil' },
  },
];

/** Messages returned by the server when a command did not work. */
const FAILURE =
  /^(Unknown|Incorrect|Invalid|Expected|No (player|entity) was found|That position is not loaded|Could not)/i;

/** Renders a (multi-line) raw command template into individual safe commands. */
export function renderRconCommands(template: string, ctx: TemplateContext, player: string): string[] {
  return renderCommandTemplate(template, ctx, player, 'java');
}

export class MinecraftRconIntegration implements Integration {
  private client: RconClient | null = null;
  private connecting: Promise<RconClient> | null = null;
  private state: IntegrationStatus = { state: 'disconnected' };

  constructor(
    private readonly config: RconConfig,
    private readonly deps: IntegrationDeps,
    private readonly factory: RconFactory = defaultFactory,
    private readonly random: () => number = Math.random,
  ) {}

  status(): IntegrationStatus {
    return this.state;
  }

  listEffects() {
    return minecraftRconDefinition.effects;
  }

  /** Connects and reports who is online (the "Test connection" button). */
  async connect(): Promise<void> {
    const client = await this.ensureClient();
    try {
      const list = (await client.send('list')).trim();
      this.state = { state: 'connected', ...(list ? { detail: list.slice(0, 200) } : {}) };
    } catch {
      // `list` is informative only.
    }
  }

  async disconnect(): Promise<void> {
    const c = this.client;
    this.client = null;
    this.connecting = null;
    this.state = { state: 'disconnected' };
    if (c) await c.end().catch(() => undefined);
  }

  commandsFor(effect: Effect, ctx: TemplateContext): string[] {
    if (effect.effectId === 'rcon.command') {
      return renderCommandTemplate(
        stringParam(effect, 'command'),
        ctx,
        this.config.player,
        this.config.version,
      );
    }
    const cmds = buildMinecraftCommands(effect, ctx, {
      edition: this.config.version,
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
      const client = await this.ensureClient();
      try {
        const res = (await client.send(cmd)).trim();
        if (FAILURE.test(res)) this.deps.log('warn', `Minecraft : « ${cmd} » → ${res}`);
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
          const hint = /auth/i.test(msg)
            ? ' (mot de passe RCON incorrect ?)'
            : /ECONNREFUSED/.test(msg)
              ? ' (serveur éteint ou RCON désactivé ?)'
              : '';
          this.state = { state: 'error', detail: msg + hint };
          throw new IntegrationError(
            `Connexion RCON impossible (${this.config.host}:${this.config.port}) : ${msg}${hint}`,
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
    {
      key: 'version',
      label: 'integrations.rcon.version',
      type: 'select',
      default: 'java',
      options: [
        { value: 'java', label: '1.21.5 et plus récent' },
        { value: 'java-legacy', label: '1.13 à 1.21.4' },
      ],
    },
  ],
  configSchema: RconConfigSchema,
  effects: [...MINECRAFT_EFFECTS, rawCommandEffect('rcon.command')],
  presets: RCON_PRESETS,
  create: (config, deps) => new MinecraftRconIntegration(config, deps),
};
