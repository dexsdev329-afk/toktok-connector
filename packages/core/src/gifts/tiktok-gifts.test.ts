import { ActionSchema, giftKey, type LiveEvent } from '@toktok/shared';
import { describe, expect, it } from 'vitest';
import { MatchState, matchAction } from '../engine/matcher';
import { isAllowedGiftImageUrl } from './image-cache';
import { TIKTOK_GIFTS, builtinTikTokGift } from './tiktok-gifts';

describe('built-in TikTok gift list', () => {
  it('has unique, safe ids and TikTok CDN images only', () => {
    expect(TIKTOK_GIFTS.length).toBeGreaterThan(1000);
    expect(new Set(TIKTOK_GIFTS.map((g) => g.id)).size).toBe(TIKTOK_GIFTS.length);
    for (const g of TIKTOK_GIFTS) {
      expect(g.id).toMatch(/^[\w-]{1,64}$/);
      expect(g.id).toBe(giftKey(g.name, g.diamonds));
      expect(isAllowedGiftImageUrl(g.imageUrl!)).toBe(true);
    }
    expect(builtinTikTokGift('tt-rose-1')).toMatchObject({ name: 'Rose', diamonds: 1 });
  });

  it('builds ids from name and value', () => {
    expect(giftKey('Rose', 1)).toBe('tt-rose-1');
    expect(giftKey("Valerian's Oath", 43999)).toBe('tt-valerian-s-oath-43999');
    expect(giftKey('Café ☕', 5)).toBe('tt-cafe-5');
    expect(giftKey('🎉', 3)).toBe('tt-gift-3');
  });

  it('lets a trigger on a built-in gift match the live gift (numeric id) by name and value', () => {
    const action = ActionSchema.parse({
      id: 'a',
      profileId: 'p',
      name: 'rose',
      trigger: { kind: 'gift', giftId: 'tt-rose-1', minCount: 1 },
      effects: [],
    });
    const live = (name: string, diamonds: number): LiveEvent => ({
      id: 'e',
      platform: 'tiktok',
      timestamp: 0,
      type: 'gift',
      user: {
        id: 'u',
        username: 'u',
        displayName: 'U',
        isModerator: false,
        isSubscriber: false,
        isFollower: false,
      },
      gift: { id: '5655', name, diamonds },
      count: 3,
      streakFinal: true,
    });
    expect(matchAction(action, live('Rose', 1), new MatchState()).units).toBe(3);
    expect(matchAction(action, live('Rose', 10), new MatchState()).units).toBe(0);
  });
});
