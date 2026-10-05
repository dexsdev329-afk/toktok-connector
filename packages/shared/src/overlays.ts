import { z } from 'zod';
import type { GiftInfo, LiveUser } from './events';

export const OverlayKindSchema = z.enum(['alerts', 'top-donors', 'like-goal']);
export type OverlayKind = z.infer<typeof OverlayKindSchema>;

export const OverlayThemeSchema = z.enum(['default', 'neon', 'minimal']);
export type OverlayTheme = z.infer<typeof OverlayThemeSchema>;

export const OverlayStyleSchema = z.object({
  theme: OverlayThemeSchema.default('default'),
  primaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#ff2d75'),
  textColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#ffffff'),
  fontFamily: z.string().max(80).default('Inter, system-ui, sans-serif'),
  fontSizePx: z.number().int().min(10).max(96).default(28),
  animation: z.enum(['pop', 'slide', 'fade', 'none']).default('pop'),
});
export type OverlayStyle = z.infer<typeof OverlayStyleSchema>;

export const AlertsOverlayOptionsSchema = z.object({
  minDiamonds: z.number().int().min(0).default(1),
  durationMs: z.number().int().min(1000).max(30_000).default(5000),
  showFollows: z.boolean().default(true),
  showShares: z.boolean().default(false),
  showSubscribes: z.boolean().default(true),
});

export const TopDonorsOverlayOptionsSchema = z.object({
  limit: z.number().int().min(1).max(20).default(5),
  title: z.string().max(60).default('Top donateurs'),
});

export const LikeGoalOverlayOptionsSchema = z.object({
  goal: z.number().int().min(1).default(10_000),
  title: z.string().max(60).default('Objectif likes'),
  /** When the goal is reached, raise it by this amount (0 = stay full). */
  autoIncrement: z.number().int().min(0).default(0),
});

export const OverlayConfigSchema = z.object({
  id: z.string().min(1),
  kind: OverlayKindSchema,
  name: z.string().min(1).max(100),
  style: OverlayStyleSchema,
  options: z.record(z.string(), z.unknown()).default({}),
});
export type OverlayConfig = z.infer<typeof OverlayConfigSchema>;

export interface TopDonor {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  diamonds: number;
}

/** Messages pushed from the app to overlay pages over the local WebSocket. */
export type OverlayServerMessage =
  | { type: 'config'; overlay: OverlayConfig }
  | {
      type: 'alert';
      alert: {
        id: string;
        kind: 'gift' | 'follow' | 'share' | 'subscribe';
        user: Pick<LiveUser, 'username' | 'displayName' | 'avatarUrl'>;
        gift?: GiftInfo;
        count?: number;
      };
    }
  | { type: 'topDonors'; donors: TopDonor[] }
  | { type: 'likes'; total: number; goal: number };
