import { z } from 'zod';

/** What makes an action fire. */
export const TriggerSchema = z.discriminatedUnion('kind', [
  /** A specific gift (by id). `minCount` lets you require e.g. "5 roses in one streak". */
  z.object({
    kind: z.literal('gift'),
    giftId: z.string().min(1),
    minCount: z.number().int().positive().default(1),
  }),
  /** Any gift whose total value (unit diamonds x count) is >= min. */
  z.object({ kind: z.literal('diamonds'), min: z.number().int().positive() }),
  /** Fires once every `every` likes (cumulated across viewers for the session). */
  z.object({ kind: z.literal('likes'), every: z.number().int().positive() }),
  z.object({ kind: z.literal('follow') }),
  z.object({ kind: z.literal('share') }),
  z.object({ kind: z.literal('subscribe') }),
  /** Chat command, written without "!" (e.g. "tnt" matches "!tnt" and "!tnt foo"). */
  z.object({
    kind: z.literal('command'),
    name: z
      .string()
      .min(1)
      .max(32)
      .regex(/^[\p{L}\p{N}_-]+$/u),
  }),
  /** Any chat message containing the given keyword (case-insensitive). */
  z.object({ kind: z.literal('keyword'), text: z.string().min(1).max(64) }),
]);
export type Trigger = z.infer<typeof TriggerSchema>;
export type TriggerKind = Trigger['kind'];

export const EffectParamsSchema = z.record(z.string(), z.unknown());

export const EffectSchema = z.object({
  /** Integration instance id (row in `integrations`), or the built-in "app" integration. */
  integrationId: z.string().min(1),
  /** Effect id inside the integration (e.g. "rcon.command"). */
  effectId: z.string().min(1),
  params: EffectParamsSchema.default({}),
  /** Wait before running this effect (ms). */
  delayMs: z.number().int().min(0).max(600_000).default(0),
  /** Run this effect N times in a row. */
  repeat: z.number().int().min(1).max(100).default(1),
  /** Delay between repeats (ms). */
  repeatIntervalMs: z.number().int().min(0).max(60_000).default(0),
});
export type Effect = z.infer<typeof EffectSchema>;

export const UserFilterSchema = z.object({
  moderatorsOnly: z.boolean().default(false),
  subscribersOnly: z.boolean().default(false),
  followersOnly: z.boolean().default(false),
  /** Usernames (lowercase) allowed; empty = everybody. */
  allowList: z.array(z.string()).default([]),
  /** Usernames (lowercase) never allowed. */
  denyList: z.array(z.string()).default([]),
});
export type UserFilter = z.infer<typeof UserFilterSchema>;

export const BusyPolicySchema = z.enum(['queue', 'skip']);
export type BusyPolicy = z.infer<typeof BusyPolicySchema>;

/**
 * once     -> one execution per triggering event
 * multiply -> one execution per gift unit (count), capped by maxMultiplier
 */
export const QuantityModeSchema = z.enum(['once', 'multiply']);
export type QuantityMode = z.infer<typeof QuantityModeSchema>;

export const ActionSchema = z.object({
  id: z.string().min(1),
  profileId: z.string().min(1),
  name: z.string().min(1).max(100),
  enabled: z.boolean().default(true),
  position: z.number().int().default(0),
  trigger: TriggerSchema,
  effects: z.array(EffectSchema).max(50),
  /** Global cooldown between two executions (ms). */
  cooldownMs: z.number().int().min(0).max(3_600_000).default(0),
  /** Per-viewer cooldown (ms). */
  userCooldownMs: z.number().int().min(0).max(3_600_000).default(0),
  /** Higher runs first. */
  priority: z.number().int().min(0).max(10).default(5),
  busyPolicy: BusyPolicySchema.default('queue'),
  quantityMode: QuantityModeSchema.default('once'),
  maxMultiplier: z.number().int().min(1).max(100).default(10),
  userFilter: UserFilterSchema.default({
    moderatorsOnly: false,
    subscribersOnly: false,
    followersOnly: false,
    allowList: [],
    denyList: [],
  }),
  soundId: z.string().nullable().default(null),
  ttsTemplate: z.string().max(300).nullable().default(null),
});
export type Action = z.infer<typeof ActionSchema>;
export type ActionInput = z.input<typeof ActionSchema>;

export const ProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  game: z.string().max(100).default(''),
  isActive: z.boolean().default(false),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const PROFILE_EXPORT_FORMAT_VERSION = 1;

export const ProfileExportSchema = z.object({
  formatVersion: z.literal(PROFILE_EXPORT_FORMAT_VERSION),
  app: z.literal('toktok-game-connector-live'),
  exportedAt: z.string(),
  profile: ProfileSchema.omit({ id: true, isActive: true }),
  actions: z.array(ActionSchema.omit({ id: true, profileId: true })),
});
export type ProfileExport = z.infer<typeof ProfileExportSchema>;
