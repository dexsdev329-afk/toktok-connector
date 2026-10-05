/**
 * Maps raw tiktok-live-connector (v2, proto "v3") payloads to normalized data.
 *
 * Payloads are typed loosely on purpose: field names differ between library
 * versions (e.g. `user.uniqueId` vs `user.displayId`, `comment` vs `content`),
 * so every accessor tolerates both shapes and missing values.
 */
import { makeId, type GiftInfo, type LiveEvent, type LiveUser } from '@toktok/shared';
import type { GiftObservation } from '../../gifts/aggregator';

type Raw = Record<string, unknown> | undefined | null;

function obj(v: unknown): Raw {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined;
}
function str(...vals: unknown[]): string {
  for (const v of vals) {
    if (typeof v === 'string' && v.length > 0) return v;
    if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  }
  return '';
}
function num(...vals: unknown[]): number {
  for (const v of vals) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
    if (typeof v === 'bigint') return Number(v);
  }
  return 0;
}
function bool(v: unknown): boolean {
  return v === true || v === 1 || v === '1' || v === 'true';
}
function imageUrl(v: unknown): string | undefined {
  const img = obj(v);
  if (!img) return typeof v === 'string' && v ? v : undefined;
  const list = (img.urlList ?? img.url_list ?? img.urls) as unknown;
  if (Array.isArray(list) && typeof list[0] === 'string') return list[0];
  return undefined;
}

export function mapUser(rawUser: unknown, identity?: unknown): LiveUser {
  const u = obj(rawUser) ?? {};
  const ident = obj(identity) ?? obj(u.userIdentity) ?? {};
  const username = str(u.uniqueId, u.displayId, u.nickname, u.userId, u.id) || 'unknown';
  const followInfo = obj(u.followInfo);
  return {
    id: str(u.userId, u.id, username),
    username,
    displayName: str(u.nickname, username),
    ...(imageUrl(u.profilePictureUrl ?? u.avatarThumb ?? u.profilePicture)
      ? { avatarUrl: imageUrl(u.profilePictureUrl ?? u.avatarThumb ?? u.profilePicture)! }
      : {}),
    isModerator: bool(ident.isModeratorOfAnchor) || bool(u.isModerator),
    isSubscriber: bool(ident.isSubscriberOfAnchor) || bool(u.isSubscriber),
    isFollower:
      bool(ident.isFollowerOfAnchor) ||
      bool(ident.isMutualFollowingWithAnchor) ||
      num(followInfo?.followStatus, u.followRole) > 0,
  };
}

function base(msg: Raw) {
  const common = obj(msg?.common);
  const ts = num(common?.createTime, msg?.createTime);
  return {
    id: str(common?.msgId, msg?.msgId) || makeId('tt'),
    platform: 'tiktok' as const,
    // TikTok sends ms timestamps; fall back to "now".
    timestamp: ts > 1e12 ? ts : Date.now(),
  };
}

export function mapGiftInfo(raw: unknown, lookup?: (id: string) => GiftInfo | undefined): GiftInfo {
  const msg = obj(raw) ?? {};
  const g = obj(msg.gift) ?? obj(msg.giftDetails) ?? {};
  const ext = obj(msg.extendedGiftInfo) ?? {};
  const id = str(msg.giftId, g.id, ext.id);
  const known = lookup?.(id);
  const image = imageUrl(g.image ?? g.icon ?? ext.image ?? ext.icon) ?? known?.imageUrl;
  return {
    id,
    name: str(g.name, g.giftName, ext.name, known?.name) || `Gift ${id}`,
    diamonds: Math.max(0, Math.floor(num(g.diamondCount, ext.diamond_count, ext.diamondCount, known?.diamonds))),
    ...(image ? { imageUrl: image } : {}),
  };
}

export function mapGiftObservation(
  raw: unknown,
  lookup?: (id: string) => GiftInfo | undefined,
): GiftObservation {
  const msg = obj(raw) ?? {};
  const g = obj(msg.gift) ?? obj(msg.giftDetails) ?? {};
  const ext = obj(msg.extendedGiftInfo) ?? {};
  const user = mapUser(msg.user, msg.userIdentity);
  const gift = mapGiftInfo(msg, lookup);
  // giftType 1 = streakable (combo) gift, per the library documentation.
  const giftType = num(g.type, g.giftType, ext.type);
  const streakable = giftType === 1 || bool(g.combo);
  return {
    platform: 'tiktok',
    user,
    gift,
    repeatCount: Math.max(1, num(msg.repeatCount, msg.comboCount, 1)),
    repeatEnd: bool(msg.repeatEnd),
    streakable,
    streakKey: `${user.id}:${gift.id}:${str(msg.groupId) || '0'}`,
  };
}

export function mapChat(raw: unknown): LiveEvent {
  const msg = obj(raw) ?? {};
  return {
    ...base(msg),
    type: 'chat',
    user: mapUser(msg.user, msg.userIdentity),
    text: str(msg.comment, msg.content),
  };
}

export function mapLike(raw: unknown): LiveEvent {
  const msg = obj(raw) ?? {};
  return {
    ...base(msg),
    type: 'like',
    user: mapUser(msg.user, msg.userIdentity),
    count: Math.max(0, Math.floor(num(msg.likeCount, msg.count))),
    total: Math.max(0, Math.floor(num(msg.totalLikeCount, msg.total))),
  };
}

export function mapSocial(raw: unknown, type: 'follow' | 'share'): LiveEvent {
  const msg = obj(raw) ?? {};
  return { ...base(msg), type, user: mapUser(msg.user, msg.userIdentity) };
}

export function mapSubscribe(raw: unknown): LiveEvent {
  const msg = obj(raw) ?? {};
  const months = Math.floor(num(msg.subMonth));
  return {
    ...base(msg),
    type: 'subscribe',
    user: mapUser(msg.user, msg.userIdentity),
    ...(months > 0 ? { months } : {}),
  };
}

export function mapViewerCount(raw: unknown): LiveEvent {
  const msg = obj(raw) ?? {};
  return {
    ...base(msg),
    type: 'viewerCount',
    count: Math.max(0, Math.floor(num(msg.viewerCount, msg.total))),
  };
}

/** Maps the response of `fetchAvailableGifts()` (shape not guaranteed). */
export function mapGiftList(raw: unknown): GiftInfo[] {
  const list: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray(obj(raw)?.gifts)
      ? (obj(raw)!.gifts as unknown[])
      : [];
  const out: GiftInfo[] = [];
  for (const item of list) {
    const g = obj(item);
    if (!g) continue;
    const id = str(g.id, g.giftId);
    const name = str(g.name);
    if (!id || !name) continue;
    const image = imageUrl(g.image ?? g.icon);
    out.push({
      id,
      name,
      diamonds: Math.max(0, Math.floor(num(g.diamond_count, g.diamondCount))),
      ...(image ? { imageUrl: image } : {}),
    });
  }
  return out;
}
