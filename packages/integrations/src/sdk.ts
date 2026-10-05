import type { Effect, TemplateContext } from '@toktok/shared';
import type { z } from 'zod';
import type { InputDriver } from './input/driver';

/** A field of the generic configuration form shown in the app. */
export interface ConfigField {
  key: string;
  /** i18n key (falls back to the key itself). */
  label: string;
  type: 'string' | 'number' | 'password' | 'boolean' | 'select';
  /** Stored encrypted (safeStorage), never sent back to the UI in clear. */
  secret?: boolean;
  default?: string | number | boolean;
  min?: number;
  max?: number;
  options?: { value: string; label: string }[];
  help?: string;
}

/** A parameter of an effect, edited in the action editor. */
export interface EffectParam {
  key: string;
  label: string;
  type: 'string' | 'text' | 'number' | 'boolean' | 'select';
  default?: string | number | boolean;
  options?: { value: string; label: string }[];
  placeholder?: string;
  help?: string;
  min?: number;
  max?: number;
}

export interface EffectDefinition {
  id: string;
  name: string;
  description?: string;
  params: EffectParam[];
}

/** Ready-made effect (e.g. "Summon a zombie") the user can add in one click. */
export interface EffectPreset {
  id: string;
  name: string;
  category: string;
  effectId: string;
  params: Record<string, unknown>;
}

export type IntegrationState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface IntegrationStatus {
  state: IntegrationState;
  detail?: string;
}

export interface Integration {
  /** Server-type integrations (the game connects to us) are started as soon as they are enabled. */
  readonly autoStart?: boolean;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  status(): IntegrationStatus;
  listEffects(): EffectDefinition[];
  execute(effect: Effect, ctx: TemplateContext, signal: AbortSignal): Promise<void>;
}

/** Host services injected into integrations (native drivers, logging...). */
export interface IntegrationDeps {
  log: (level: 'info' | 'warn' | 'error', message: string) => void;
  input?: InputDriver;
  /** Notifies the host that status() changed on its own (e.g. the game connected). */
  statusChanged?: () => void;
}

export interface IntegrationDefinition<C = Record<string, unknown>> {
  kind: string;
  name: string;
  description: string;
  configFields: ConfigField[];
  configSchema: z.ZodType<C>;
  effects: EffectDefinition[];
  presets?: EffectPreset[];
  create(config: C, deps: IntegrationDeps): Integration;
}

export class IntegrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IntegrationError';
  }
}

export function stringParam(effect: Effect, key: string, fallback = ''): string {
  const v = effect.params[key];
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : fallback;
}

export function numberParam(
  effect: Effect,
  key: string,
  fallback: number,
  min = -Infinity,
  max = Infinity,
): number {
  const raw = effect.params[key];
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
