import { z } from 'zod';
import type { GiftInfo, LiveUser, Platform } from './events';

export const OverlayKindSchema = z.enum([
  'alerts',
  'top-donors',
  'like-goal',
  'chat',
  'viewers',
  'wheel',
  'timer',
  'recent-followers',
]);
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
  // Advanced settings (theme editor). Undefined = the base theme decides.
  /** Card background color and its opacity (0-100). */
  cardColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  cardOpacity: z.number().int().min(0).max(100).optional(),
  radiusPx: z.number().int().min(0).max(48).optional(),
  borderWidthPx: z.number().int().min(0).max(8).optional(),
  shadow: z.enum(['none', 'soft', 'glow']).optional(),
  /** Dark outline around the text, for readability on busy game backgrounds. */
  textOutline: z.boolean().optional(),
});
export type OverlayStyle = z.infer<typeof OverlayStyleSchema>;

/** A named, reusable style. */
export const OverlayThemeDefSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(60),
  style: OverlayStyleSchema,
});
export type OverlayThemeDef = z.infer<typeof OverlayThemeDefSchema>;

/** Built-in starting points (original designs). */
export const OVERLAY_THEME_PRESETS: OverlayThemeDef[] = [
  {
    id: 'preset-toktok',
    name: 'TokTok',
    style: {
      theme: 'default',
      primaryColor: '#ff2d75',
      textColor: '#ffffff',
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSizePx: 28,
      animation: 'pop',
    },
  },
  {
    id: 'preset-arcade',
    name: 'Arcade',
    style: {
      theme: 'neon',
      primaryColor: '#22e3ff',
      textColor: '#f5f7ff',
      fontFamily: '"Courier New", monospace',
      fontSizePx: 26,
      animation: 'slide',
      cardColor: '#05010f',
      cardOpacity: 85,
      radiusPx: 4,
      borderWidthPx: 3,
      shadow: 'glow',
    },
  },
  {
    id: 'preset-glass',
    name: 'Verre',
    style: {
      theme: 'default',
      primaryColor: '#a78bfa',
      textColor: '#ffffff',
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSizePx: 28,
      animation: 'fade',
      cardColor: '#ffffff',
      cardOpacity: 14,
      radiusPx: 24,
      borderWidthPx: 1,
      shadow: 'soft',
      textOutline: true,
    },
  },
  {
    id: 'preset-green',
    name: 'Vert néon',
    style: {
      theme: 'neon',
      primaryColor: '#53fc18',
      textColor: '#ffffff',
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSizePx: 28,
      animation: 'pop',
    },
  },
  {
    id: 'preset-clean',
    name: 'Épuré',
    style: {
      theme: 'minimal',
      primaryColor: '#ffd23f',
      textColor: '#ffffff',
      fontFamily: 'Georgia, serif',
      fontSizePx: 30,
      animation: 'fade',
      textOutline: true,
    },
  },
];

/** CSS custom properties and modifier classes for a style (shared by the overlays and the app preview). */
export function overlayStyleVars(s: OverlayStyle): { vars: Record<string, string>; classes: string[] } {
  const vars: Record<string, string> = {
    '--primary': s.primaryColor,
    '--text': s.textColor,
    '--font': s.fontFamily,
    '--size': `${s.fontSizePx}px`,
  };
  const classes = [`theme-${s.theme}`, `anim-${s.animation}`];
  if (s.cardColor) {
    const n = parseInt(s.cardColor.slice(1), 16);
    const a = (s.cardOpacity ?? 72) / 100;
    vars['--card-bg'] = `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
    classes.push('has-bg');
  }
  if (s.radiusPx !== undefined) {
    vars['--radius'] = `${s.radiusPx}px`;
    classes.push('has-radius');
  }
  if (s.borderWidthPx !== undefined) {
    vars['--border-w'] = `${s.borderWidthPx}px`;
    classes.push('has-border');
  }
  if (s.shadow) classes.push(`shadow-${s.shadow}`);
  if (s.textOutline) classes.push('text-outline');
  return { vars, classes };
}

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

export const ChatOverlayOptionsSchema = z.object({
  maxMessages: z.number().int().min(1).max(30).default(8),
  /** Hide "!command" messages (they trigger actions and clutter the chat). */
  hideCommands: z.boolean().default(true),
  /** Remove messages after N seconds (0 = keep). */
  fadeAfterSec: z.number().int().min(0).max(600).default(0),
  showPlatform: z.boolean().default(true),
  showAvatars: z.boolean().default(true),
});

export const ViewersOverlayOptionsSchema = z.object({
  label: z.string().max(40).default('Spectateurs'),
  showLikes: z.boolean().default(false),
});

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const WheelSegmentSchema = z.object({
  label: z.string().min(1).max(40),
  color: hexColor.optional(),
  /** Relative chance (1 = normal, 2 = twice as likely). */
  weight: z.number().min(0.1).max(100).default(1),
  /** Action run when the wheel stops on this segment (with the viewer who spun it). */
  actionId: z.string().max(100).optional(),
});
export type WheelSegment = z.infer<typeof WheelSegmentSchema>;

export const WheelOverlayOptionsSchema = z.object({
  title: z.string().max(60).default('Roue'),
  segments: z
    .array(WheelSegmentSchema)
    .min(2)
    .max(24)
    .default([
      { label: 'Zombie', weight: 1 },
      { label: 'TNT', weight: 1 },
      { label: 'Diamants', weight: 1 },
      { label: 'Rien', weight: 1 },
      { label: 'Creeper', weight: 1 },
      { label: 'Soin', weight: 1 },
    ]),
  spinMs: z.number().int().min(2000).max(20_000).default(6000),
  /** Hide the wheel between spins. */
  hideWhenIdle: z.boolean().default(false),
});

export const TimerOverlayOptionsSchema = z.object({
  title: z.string().max(60).default('Subathon'),
  initialSeconds: z
    .number()
    .int()
    .min(0)
    .max(30 * 86_400)
    .default(600),
  /** Upper bound of the remaining time (0 = no limit). */
  maxSeconds: z
    .number()
    .int()
    .min(0)
    .max(30 * 86_400)
    .default(0),
  endText: z.string().max(60).default('Terminé !'),
});

export const RecentFollowersOverlayOptionsSchema = z.object({
  title: z.string().max(60).default('Derniers followers'),
  limit: z.number().int().min(1).max(20).default(5),
  includeSubscribers: z.boolean().default(true),
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
  | { type: 'likes'; total: number; goal: number }
  | OverlayServerMessageExtra;

export interface ChatLine {
  id: string;
  platform: Platform;
  user: Pick<LiveUser, 'displayName' | 'avatarUrl' | 'isModerator' | 'isSubscriber'>;
  text: string;
}

export interface RecentFollower {
  id: string;
  platform: Platform;
  kind: 'follow' | 'subscribe';
  displayName: string;
  avatarUrl?: string;
}

/** Messages of the phase 3 overlays. */
export type OverlayServerMessageExtra =
  /** `replace` = full history (on connect), otherwise lines to append. */
  | { type: 'chat'; lines: ChatLine[]; replace: boolean }
  | { type: 'viewers'; viewers: number; likes: number }
  | {
      type: 'wheelSpin';
      spin: { id: string; index: number; label: string; durationMs: number; by?: string };
    }
  /** Remaining time when the message was sent; the page counts down locally while running. */
  | { type: 'timer'; running: boolean; remainingMs: number }
  | { type: 'recentFollowers'; users: RecentFollower[] };

const OPTION_SCHEMAS: Record<OverlayKind, z.ZodType<Record<string, unknown>>> = {
  alerts: AlertsOverlayOptionsSchema,
  'top-donors': TopDonorsOverlayOptionsSchema,
  'like-goal': LikeGoalOverlayOptionsSchema,
  chat: ChatOverlayOptionsSchema,
  viewers: ViewersOverlayOptionsSchema,
  wheel: WheelOverlayOptionsSchema,
  timer: TimerOverlayOptionsSchema,
  'recent-followers': RecentFollowersOverlayOptionsSchema,
};

/** Validates the options of an overlay kind and fills the defaults (throws on invalid input). */
export function parseOverlayOptions(kind: OverlayKind, options: unknown): Record<string, unknown> {
  return OPTION_SCHEMAS[kind].parse(options ?? {});
}

/** Default color of wheel slice `i` of `n` (hues spread around the circle), as #rrggbb. */
export function wheelSliceColor(i: number, n: number): string {
  const h = (i * 360) / Math.max(1, n);
  const s = 0.75;
  const l = i % 2 ? 0.48 : 0.58;
  const f = (k: number) => {
    const x = (k + h / 30) % 12;
    const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(x - 3, 9 - x, 1));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
