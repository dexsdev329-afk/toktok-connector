import { giftKey, type GiftInfo } from '@toktok/shared';
import { TIKTOK_GIFTS_DATA } from './tiktok-gifts-data';

const CDN = 'https://p16-webcast.tiktokcdn.com/img/';

/** Built-in TikTok gift list, so every gift can be picked before the first live. */
export const TIKTOK_GIFTS: readonly GiftInfo[] = TIKTOK_GIFTS_DATA.map(([name, diamonds, imagePath]) => ({
  id: giftKey(name, diamonds),
  name,
  diamonds,
  imageUrl: CDN + imagePath,
}));

const byId = new Map(TIKTOK_GIFTS.map((g) => [g.id, g]));

export function builtinTikTokGift(id: string): GiftInfo | undefined {
  return byId.get(id);
}
