/**
 * Maps Kick Pusher payloads to normalized events.
 *
 * Kick does not document its public Pusher feed. The shapes below were observed on live channels
 * (October 2026); every accessor tolerates missing fields so a format change degrades gracefully
 * (an event is dropped) instead of crashing the connector.
 */
import { makeId, type GiftInfo, type LiveEvent, type LiveUser } from '@toktok/shared';

type Raw = Record<string, unknown>;

function obj(v: unknown): Raw | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : undefined;
}
function str(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  return '';
}
function num(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}

/** Id prefix of Kick gifts in the catalog, so they never collide with TikTok gift ids. */
export const KICK_GIFT_PREFIX = 'kick:';
/** Synthetic gift used for gifted subscriptions ("count" = number of subs). */
export const KICK_GIFTED_SUB: GiftInfo = { id: 'kick:gifted-sub', name: 'Abonnement offert', diamonds: 0 };

/** Kick event names (Pusher `event` field). */
export const KICK_EVENTS = {
  chat: 'App\\Events\\ChatMessageEvent',
  subscription: 'App\\Events\\ChannelSubscriptionEvent',
  subscriptionLegacy: 'App\\Events\\SubscriptionEvent',
  giftedSubs: 'App\\Events\\GiftedSubscriptionsEvent',
  followers: 'App\\Events\\FollowersUpdated',
  activity: 'App\\Events\\NewActivityFeedEvent',
  kicks: 'KicksGifted',
  streamEnd: 'App\\Events\\StopStreamBroadcast',
} as const;

/** Turns "[emote:37226:KEKW]" into "KEKW" so commands and TTS see plain text. */
export function cleanKickText(content: string): string {
  return content.replace(/\[emote:\d+:([^\]]*)\]/g, '$1').trim();
}

export function mapKickUser(sender: unknown): LiveUser {
  const s = obj(sender) ?? {};
  const username = str(s.username) || 'unknown';
  const identity = obj(s.identity);
  const badges = Array.isArray(identity?.badges) ? identity.badges : [];
  const types = new Set(badges.map((b) => str(obj(b)?.type)));
  const avatar = str(s.profile_picture);
  return {
    id: str(s.id) || username,
    username: str(s.slug) || username.toLowerCase(),
    displayName: username,
    ...(avatar ? { avatarUrl: avatar } : {}),
    isModerator: types.has('moderator') || types.has('broadcaster'),
    isSubscriber: types.has('subscriber') || types.has('founder'),
    isFollower: false,
  };
}

function userFromName(name: string): LiveUser {
  return {
    id: name,
    username: name.toLowerCase(),
    displayName: name,
    isModerator: false,
    isSubscriber: false,
    isFollower: false,
  };
}

export function mapKickGift(raw: unknown): GiftInfo | null {
  const g = obj(raw);
  const id = str(g?.gift_id);
  if (!g || !id) return null;
  return {
    id: KICK_GIFT_PREFIX + id,
    name: str(g.name) || id,
    diamonds: Math.max(0, Math.floor(num(g.amount))),
  };
}

export function mapKickGiftList(raw: unknown): GiftInfo[] {
  const list = obj(raw)?.data;
  if (!Array.isArray(list)) return [];
  return list.map(mapKickGift).filter((g): g is GiftInfo => g !== null && g.diamonds > 0);
}

/**
 * Maps one Pusher message. Returns zero, one or several events (never throws).
 * `data` is the already-parsed `data` field of the Pusher message.
 */
export function mapKickMessage(event: string, data: unknown, now = Date.now()): LiveEvent[] {
  const d = obj(data);
  if (!d) return [];
  const base = { platform: 'kick' as const, timestamp: now };
  switch (event) {
    case KICK_EVENTS.chat: {
      const text = cleanKickText(str(d.content));
      if (!text) return [];
      return [{ ...base, id: makeId('kch'), type: 'chat', user: mapKickUser(d.sender), text }];
    }
    case KICK_EVENTS.subscription:
    case KICK_EVENTS.subscriptionLegacy: {
      const name = str(d.username);
      if (!name) return [];
      const months = Math.floor(num(d.months));
      return [
        {
          ...base,
          id: makeId('ksb'),
          type: 'subscribe',
          user: { ...userFromName(name), isSubscriber: true },
          ...(months > 0 ? { months } : {}),
        },
      ];
    }
    case KICK_EVENTS.giftedSubs: {
      const gifter = str(d.gifter_username);
      const count = Array.isArray(d.gifted_usernames) ? d.gifted_usernames.length : 0;
      if (!gifter || count < 1) return [];
      return [
        {
          ...base,
          id: makeId('kgs'),
          type: 'gift',
          user: userFromName(gifter),
          gift: KICK_GIFTED_SUB,
          count,
          streakFinal: true,
        },
      ];
    }
    case KICK_EVENTS.kicks: {
      const gift = mapKickGift(d.gift);
      if (!gift) return [];
      return [
        {
          ...base,
          id: makeId('kgf'),
          type: 'gift',
          user: mapKickUser(d.sender),
          gift,
          count: 1,
          streakFinal: true,
        },
      ];
    }
    case KICK_EVENTS.followers: {
      // Only "followed" with a username is usable; anonymous counter updates are ignored.
      const name = str(d.username);
      if (d.followed !== true || !name) return [];
      return [
        { ...base, id: makeId('kfo'), type: 'follow', user: { ...userFromName(name), isFollower: true } },
      ];
    }
    case KICK_EVENTS.activity: {
      const name = str(d.username);
      if (!name || (d.type !== 'new_follower' && d.type !== 'follow')) return [];
      return [
        { ...base, id: makeId('kfo'), type: 'follow', user: { ...userFromName(name), isFollower: true } },
      ];
    }
    default:
      return [];
  }
}

/** Channel data we need from https://kick.com/api/v2/channels/{slug}. */
export interface KickChannelInfo {
  channelId: number;
  chatroomId: number;
  slug: string;
  live: boolean;
  viewers: number;
}

export function parseKickChannel(raw: unknown): KickChannelInfo | null {
  const d = obj(raw);
  const chatroom = obj(d?.chatroom);
  const channelId = num(d?.id);
  const chatroomId = num(chatroom?.id);
  if (!d || !channelId || !chatroomId) return null;
  const live = obj(d.livestream);
  return {
    channelId,
    chatroomId,
    slug: str(d.slug),
    live: Boolean(live && live.is_live !== false),
    viewers: Math.max(0, Math.floor(num(live?.viewer_count))),
  };
}

export function normalizeKickChannel(input: string): string {
  let s = input.trim();
  const m = /kick\.com\/([^/?#]+)/i.exec(s);
  if (m) s = m[1]!;
  return s.replace(/^@/, '').trim().toLowerCase();
}
