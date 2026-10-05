/**
 * Feature flags. Phase 1-3: everything unlocked ("pro").
 * Phase 4 will plug a signed license token in here without touching callers.
 */
export type Plan = 'free' | 'pro';

export interface Entitlements {
  plan: Plan;
  maxActions: number;
  overlays: 'basic' | 'all';
  integrations: 'basic' | 'all';
}

export const FREE_ENTITLEMENTS: Entitlements = {
  plan: 'free',
  maxActions: 3,
  overlays: 'basic',
  integrations: 'basic',
};

export const PRO_ENTITLEMENTS: Entitlements = {
  plan: 'pro',
  maxActions: Number.POSITIVE_INFINITY,
  overlays: 'all',
  integrations: 'all',
};

export interface EntitlementsProvider {
  current(): Entitlements;
}

export const unlockedEntitlements: EntitlementsProvider = { current: () => PRO_ENTITLEMENTS };

export function canAddAction(e: Entitlements, currentCount: number): boolean {
  return currentCount < e.maxActions;
}
