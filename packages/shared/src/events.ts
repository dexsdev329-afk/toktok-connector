import { z } from 'zod';

export const PlatformSchema = z.enum(['tiktok', 'kick', 'simulator']);
export type Platform = z.infer<typeof PlatformSchema>;

export const LiveUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().optional(),
  isModerator: z.boolean().default(false),
  isSubscriber: z.boolean().default(false),
  isFollower: z.boolean().default(false),
});
export type LiveUser = z.infer<typeof LiveUserSchema>;

export const GiftInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Value of ONE gift unit, in diamonds. */
  diamonds: z.number().int().nonnegative(),
  imageUrl: z.string().optional(),
});
export type GiftInfo = z.infer<typeof GiftInfoSchema>;

const base = {
  id: z.string(),
  platform: PlatformSchema,
  timestamp: z.number(),
};

export const LiveEventSchema = z.discriminatedUnion('type', [
  z.object({
    ...base,
    type: z.literal('gift'),
    user: LiveUserSchema,
    gift: GiftInfoSchema,
    /** Number of gift units this event accounts for (already aggregated according to the streak mode). */
    count: z.number().int().positive(),
    streakId: z.string().optional(),
    /** True when the streak is over (or the gift is not streakable). */
    streakFinal: z.boolean(),
  }),
  z.object({
    ...base,
    type: z.literal('like'),
    user: LiveUserSchema,
    count: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
  z.object({ ...base, type: z.literal('follow'), user: LiveUserSchema }),
  z.object({ ...base, type: z.literal('share'), user: LiveUserSchema }),
  z.object({ ...base, type: z.literal('chat'), user: LiveUserSchema, text: z.string() }),
  z.object({
    ...base,
    type: z.literal('subscribe'),
    user: LiveUserSchema,
    months: z.number().int().positive().optional(),
  }),
  z.object({ ...base, type: z.literal('viewerCount'), count: z.number().int().nonnegative() }),
  z.object({ ...base, type: z.literal('connected'), channel: z.string() }),
  z.object({
    ...base,
    type: z.literal('disconnected'),
    reason: z.string().optional(),
    liveEnded: z.boolean().default(false),
  }),
]);
export type LiveEvent = z.infer<typeof LiveEventSchema>;
export type LiveEventType = LiveEvent['type'];
export type LiveEventOf<T extends LiveEventType> = Extract<LiveEvent, { type: T }>;

/** Events that carry a viewer. */
export type UserLiveEvent = Extract<LiveEvent, { user: LiveUser }>;

export function hasUser(event: LiveEvent): event is UserLiveEvent {
  return 'user' in event;
}

let counter = 0;
/** Small unique id generator usable in both Node and browsers (no crypto dependency). */
export function makeId(prefix = 'evt'): string {
  counter = (counter + 1) % 1_000_000;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Stable id of a TikTok gift from its name and value ("Rose", 1 -> "tt-rose-1"), used by the
 * built-in gift list (which has no numeric TikTok ids). Live gifts match it by name and value.
 */
export function giftKey(name: string, diamonds: number): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[^\u0020-\u007e]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `tt-${slug || 'gift'}-${diamonds}`;
}
