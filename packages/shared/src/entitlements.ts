/**
 * Feature flags of the Free and Pro plans. The plan comes from the signed license
 * (packages/core/src/license); everything that differs between plans is decided here.
 */
export type Plan = 'free' | 'pro';

export interface Entitlements {
  plan: Plan;
  maxActions: number;
  overlays: 'basic' | 'all';
  integrations: 'basic' | 'all';
  /** Kick connection (multistream). */
  kick: boolean;
  /** Advanced style, presets and saved themes for overlays. */
  themeEditor: boolean;
  /** Paid TTS voices (ElevenLabs). */
  premiumTts: boolean;
}

export const FREE_ENTITLEMENTS: Entitlements = {
  plan: 'free',
  maxActions: 3,
  overlays: 'basic',
  integrations: 'basic',
  kick: false,
  themeEditor: false,
  premiumTts: false,
};

export const PRO_ENTITLEMENTS: Entitlements = {
  plan: 'pro',
  maxActions: Number.POSITIVE_INFINITY,
  overlays: 'all',
  integrations: 'all',
  kick: true,
  themeEditor: true,
  premiumTts: true,
};

/** Overlay kinds available on the free plan. */
export const BASIC_OVERLAY_KINDS: readonly string[] = ['alerts', 'top-donors', 'like-goal'];

/** Integration kinds available on the free plan (built-in helpers included). */
export const BASIC_INTEGRATION_KINDS: readonly string[] = [
  'minecraft-rcon',
  'minecraft-bedrock',
  'input',
  'home-games',
  'overlays',
];

export interface EntitlementsProvider {
  current(): Entitlements;
}

export const unlockedEntitlements: EntitlementsProvider = { current: () => PRO_ENTITLEMENTS };

export function entitlementsFor(plan: Plan): Entitlements {
  return plan === 'pro' ? PRO_ENTITLEMENTS : FREE_ENTITLEMENTS;
}

export function canAddAction(e: Entitlements, currentCount: number): boolean {
  return currentCount < e.maxActions;
}

export function overlayAllowed(e: Entitlements, kind: string): boolean {
  return e.overlays === 'all' || BASIC_OVERLAY_KINDS.includes(kind);
}

export function integrationAllowed(e: Entitlements, kind: string): boolean {
  return e.integrations === 'all' || BASIC_INTEGRATION_KINDS.includes(kind);
}
