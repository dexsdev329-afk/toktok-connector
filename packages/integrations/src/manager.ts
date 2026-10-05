import type { Effect, LiveEvent, TemplateContext } from '@toktok/shared';
import { inputDefinition } from './input/input-integration';
import { minecraftBedrockDefinition } from './minecraft-bedrock/minecraft-bedrock';
import { minecraftRconDefinition } from './minecraft-rcon/minecraft-rcon';
import { modBridgeDefinition } from './mod-bridge/mod-bridge';
import { webhookDefinition } from './webhook/webhook';
import {
  IntegrationError,
  type EffectDefinition,
  type Integration,
  type IntegrationDefinition,
  type IntegrationDeps,
  type IntegrationStatus,
} from './sdk';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const BUILTIN_DEFINITIONS: IntegrationDefinition<any>[] = [
  minecraftRconDefinition,
  minecraftBedrockDefinition,
  inputDefinition,
  modBridgeDefinition,
  webhookDefinition,
];

export interface IntegrationInstanceConfig {
  id: string;
  kind: string;
  name: string;
  enabled: boolean;
  /** Plain config merged with decrypted secrets. */
  config: Record<string, unknown>;
}

/**
 * Owns integration instances and implements the engine's EffectRunner.
 */
export class IntegrationManager {
  private readonly definitions = new Map<string, IntegrationDefinition<unknown>>();
  private readonly instances = new Map<string, { cfg: IntegrationInstanceConfig; impl: Integration }>();

  constructor(
    private readonly deps: IntegrationDeps,
    definitions: IntegrationDefinition<unknown>[] = BUILTIN_DEFINITIONS,
  ) {
    for (const d of definitions) this.definitions.set(d.kind, d);
  }

  listDefinitions(): IntegrationDefinition<unknown>[] {
    return [...this.definitions.values()];
  }

  getDefinition(kind: string): IntegrationDefinition<unknown> | undefined {
    return this.definitions.get(kind);
  }

  /** (Re)creates an instance with a validated config. Throws on invalid config. */
  async upsert(cfg: IntegrationInstanceConfig): Promise<void> {
    const def = this.definitions.get(cfg.kind);
    if (!def) throw new IntegrationError(`Type d’intégration inconnu: ${cfg.kind}`);
    const parsed = def.configSchema.parse(cfg.config);
    await this.remove(cfg.id);
    if (!cfg.enabled) return;
    const impl = def.create(parsed, this.deps);
    this.instances.set(cfg.id, { cfg, impl });
    if (impl.autoStart) {
      await impl.connect().catch((err: unknown) => {
        this.deps.log('warn', `${cfg.name} : ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  }

  async remove(id: string): Promise<void> {
    const inst = this.instances.get(id);
    this.instances.delete(id);
    if (inst) await inst.impl.disconnect().catch(() => undefined);
  }

  async connect(id: string): Promise<void> {
    const inst = this.instances.get(id);
    if (!inst) throw new IntegrationError('Intégration désactivée ou introuvable');
    await inst.impl.connect();
  }

  status(id: string): IntegrationStatus {
    return this.instances.get(id)?.impl.status() ?? { state: 'disconnected', detail: 'désactivée' };
  }

  /** Effects of a running instance (bridges add effects declared by connected mods). */
  instanceEffects(id: string): EffectDefinition[] | null {
    return this.instances.get(id)?.impl.listEffects() ?? null;
  }

  /** Forwards a live event to integrations that want it (never throws). */
  broadcast(event: LiveEvent): void {
    for (const { impl } of this.instances.values()) {
      try {
        impl.onLiveEvent?.(event);
      } catch {
        // an integration must never break event delivery
      }
    }
  }

  async disposeAll(): Promise<void> {
    await Promise.all([...this.instances.keys()].map((id) => this.remove(id)));
  }

  /** EffectRunner implementation used by the ActionEngine. */
  async run(effect: Effect, ctx: TemplateContext, signal: AbortSignal): Promise<void> {
    const inst = this.instances.get(effect.integrationId);
    if (!inst) throw new IntegrationError('Intégration désactivée ou introuvable');
    await inst.impl.execute(effect, ctx, signal);
  }
}
