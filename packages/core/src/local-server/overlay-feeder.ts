import {
  AlertsOverlayOptionsSchema,
  ChatOverlayOptionsSchema,
  LikeGoalOverlayOptionsSchema,
  RecentFollowersOverlayOptionsSchema,
  TimerOverlayOptionsSchema,
  TopDonorsOverlayOptionsSchema,
  WheelOverlayOptionsSchema,
  makeId,
  type ChatLine,
  type LiveEvent,
  type OverlayConfig,
  type OverlayServerMessage,
  type RecentFollower,
  type TemplateContext,
  type WheelSegment,
} from '@toktok/shared';
import type { SessionTracker } from '../stats/session-tracker';

/** Goal shown by the like gauge: grows by `autoIncrement` steps once reached. */
export function effectiveLikeGoal(total: number, goal: number, autoIncrement: number): number {
  if (autoIncrement <= 0 || total < goal) return goal;
  return goal + (Math.floor((total - goal) / autoIncrement) + 1) * autoIncrement;
}

/** Picks a segment index according to the segment weights. `r` is in [0, 1). */
export function pickWeighted(segments: Pick<WheelSegment, 'weight'>[], r: number): number {
  const total = segments.reduce((sum, s) => sum + s.weight, 0);
  let x = r * total;
  for (let i = 0; i < segments.length; i++) {
    x -= segments[i]!.weight;
    if (x < 0) return i;
  }
  return segments.length - 1;
}

export type TimerOp = 'start' | 'pause' | 'toggle' | 'reset' | 'add' | 'set';

export interface FeederOptions {
  throttleMs?: number;
  now?: () => number;
  random?: () => number;
  /** Called when a wheel stops (runs the segment's action). */
  onWheelResult?: (overlay: OverlayConfig, segment: WheelSegment, ctx: TemplateContext | undefined) => void;
}

interface TimerState {
  remainingMs: number;
  /** Set while running: the countdown started (or resumed) at this time. */
  startedAt: number | null;
}

interface WheelState {
  busyUntil: number;
  queue: (TemplateContext | undefined)[];
  timer: ReturnType<typeof setTimeout> | null;
}

const CHAT_HISTORY = 30;
const RECENT_HISTORY = 20;
const MAX_WHEEL_QUEUE = 20;
/** Time the result stays visible before the next queued spin. */
const WHEEL_RESULT_MS = 2500;

/**
 * Builds the messages each overlay needs from live events and session stats.
 * Also owns the state of interactive overlays (wheel spins, countdown timers).
 */
export class OverlayFeeder {
  private donorsTimer: ReturnType<typeof setTimeout> | null = null;
  private viewersTimer: ReturnType<typeof setTimeout> | null = null;
  /** Units already received for running streaks ("repeat" mode sends deltas). */
  private readonly streakTotals = new Map<string, number>();
  private readonly chat: ChatLine[] = [];
  private readonly recent: RecentFollower[] = [];
  private readonly timers = new Map<string, TimerState>();
  private readonly wheels = new Map<string, WheelState>();
  private readonly throttleMs: number;
  private readonly now: () => number;
  private readonly random: () => number;

  constructor(
    private readonly overlays: () => OverlayConfig[],
    private readonly stats: SessionTracker,
    private readonly send: (overlayId: string, msg: OverlayServerMessage) => void,
    private readonly opts: FeederOptions = {},
  ) {
    this.throttleMs = opts.throttleMs ?? 400;
    this.now = opts.now ?? Date.now;
    this.random = opts.random ?? Math.random;
  }

  /** Messages sent when an overlay page connects. */
  initialMessages(overlayId: string): OverlayServerMessage[] {
    const overlay = this.overlays().find((o) => o.id === overlayId);
    if (!overlay) return [];
    return [{ type: 'config', overlay }, ...this.stateFor(overlay)];
  }

  /** Pushes a config change to the open pages. */
  configChanged(overlay: OverlayConfig): void {
    this.send(overlay.id, { type: 'config', overlay });
    for (const m of this.stateFor(overlay)) this.send(overlay.id, m);
  }

  handle(event: LiveEvent): void {
    const line = event.type === 'chat' ? this.recordChat(event) : null;
    const follower =
      event.type === 'follow' || event.type === 'subscribe' ? this.recordFollower(event) : null;
    for (const overlay of this.overlays()) {
      if (overlay.kind === 'alerts') {
        const alert = this.alertFor(overlay, event);
        if (alert) this.send(overlay.id, alert);
      } else if (overlay.kind === 'chat' && line && this.chatVisible(overlay, line)) {
        this.send(overlay.id, { type: 'chat', lines: [line], replace: false });
      } else if (overlay.kind === 'recent-followers' && follower) {
        for (const m of this.stateFor(overlay)) this.send(overlay.id, m);
      }
    }
    if (['viewerCount', 'like', 'connected', 'disconnected'].includes(event.type)) this.scheduleViewers();
    if (event.type === 'gift' || event.type === 'connected' || event.type === 'disconnected') {
      this.scheduleDonors();
    }
    if (event.type === 'like' || event.type === 'connected' || event.type === 'disconnected') {
      for (const o of this.overlays())
        if (o.kind === 'like-goal') for (const m of this.stateFor(o)) this.send(o.id, m);
    }
  }

  /** Re-sends state to every overlay (after a manual session reset). */
  refreshAll(): void {
    for (const o of this.overlays()) for (const m of this.stateFor(o)) this.send(o.id, m);
  }

  dispose(): void {
    if (this.donorsTimer) clearTimeout(this.donorsTimer);
    if (this.viewersTimer) clearTimeout(this.viewersTimer);
    this.donorsTimer = this.viewersTimer = null;
    for (const w of this.wheels.values()) if (w.timer) clearTimeout(w.timer);
    this.wheels.clear();
  }

  // ------------------------------------------------------------------ timer

  /**
   * Controls countdown overlays. `target` is an overlay name or id, or "*" for every timer.
   * Returns the number of timers affected.
   */
  controlTimer(target: string, op: TimerOp, seconds = 0): number {
    const list = this.targets('timer', target);
    for (const overlay of list) {
      const opts = TimerOverlayOptionsSchema.parse(overlay.options);
      const st = this.timerState(overlay);
      const remaining = this.remaining(st);
      const cap = (ms: number) =>
        Math.max(0, opts.maxSeconds > 0 ? Math.min(ms, opts.maxSeconds * 1000) : ms);
      const running = st.startedAt !== null;
      const start = (ms: number, run: boolean) => {
        st.remainingMs = cap(ms);
        st.startedAt = run ? this.now() : null;
      };
      switch (op) {
        case 'start':
          start(remaining, true);
          break;
        case 'pause':
          start(remaining, false);
          break;
        case 'toggle':
          start(remaining, !running);
          break;
        case 'reset':
          start(opts.initialSeconds * 1000, false);
          break;
        case 'add':
          start(remaining + seconds * 1000, running);
          break;
        case 'set':
          start(seconds * 1000, running);
          break;
      }
      for (const m of this.stateFor(overlay)) this.send(overlay.id, m);
    }
    return list.length;
  }

  private timerState(overlay: OverlayConfig): TimerState {
    let st = this.timers.get(overlay.id);
    if (!st) {
      const opts = TimerOverlayOptionsSchema.parse(overlay.options);
      st = { remainingMs: opts.initialSeconds * 1000, startedAt: null };
      this.timers.set(overlay.id, st);
    }
    return st;
  }

  private remaining(st: TimerState): number {
    return st.startedAt === null ? st.remainingMs : Math.max(0, st.remainingMs - (this.now() - st.startedAt));
  }

  // ------------------------------------------------------------------ wheel

  /** Spins (or queues a spin of) the wheels matching `target`. Returns the number of wheels. */
  spinWheel(target: string, ctx?: TemplateContext): number {
    const list = this.targets('wheel', target);
    for (const overlay of list) {
      let st = this.wheels.get(overlay.id);
      if (!st) {
        st = { busyUntil: 0, queue: [], timer: null };
        this.wheels.set(overlay.id, st);
      }
      if (st.queue.length >= MAX_WHEEL_QUEUE) continue;
      st.queue.push(ctx);
      if (!st.timer) this.nextSpin(overlay.id);
    }
    return list.length;
  }

  private nextSpin(overlayId: string): void {
    const st = this.wheels.get(overlayId);
    const overlay = this.overlays().find((o) => o.id === overlayId);
    if (!st || !overlay || overlay.kind !== 'wheel') {
      this.wheels.delete(overlayId);
      return;
    }
    const wait = st.busyUntil - this.now();
    if (wait > 0) {
      st.timer = setTimeout(() => {
        st.timer = null;
        this.nextSpin(overlayId);
      }, wait);
      return;
    }
    const ctx = st.queue.shift();
    const opts = WheelOverlayOptionsSchema.parse(overlay.options);
    const index = pickWeighted(opts.segments, this.random());
    const segment = opts.segments[index]!;
    st.busyUntil = this.now() + opts.spinMs + WHEEL_RESULT_MS;
    this.send(overlay.id, {
      type: 'wheelSpin',
      spin: {
        id: makeId('spin'),
        index,
        label: segment.label,
        durationMs: opts.spinMs,
        ...(ctx?.displayName ? { by: ctx.displayName } : {}),
      },
    });
    st.timer = setTimeout(() => {
      st.timer = null;
      this.opts.onWheelResult?.(overlay, segment, ctx);
      if (st.queue.length) this.nextSpin(overlayId);
    }, opts.spinMs);
  }

  private targets(kind: OverlayConfig['kind'], target: string): OverlayConfig[] {
    const t = target.trim().toLowerCase();
    return this.overlays().filter(
      (o) =>
        o.kind === kind && (t === '' || t === '*' || o.id === target.trim() || o.name.toLowerCase() === t),
    );
  }

  // ------------------------------------------------------------------ chat & followers

  private recordChat(event: Extract<LiveEvent, { type: 'chat' }>): ChatLine {
    const line: ChatLine = {
      id: event.id,
      platform: event.platform,
      user: {
        displayName: event.user.displayName,
        ...(event.user.avatarUrl ? { avatarUrl: event.user.avatarUrl } : {}),
        isModerator: event.user.isModerator,
        isSubscriber: event.user.isSubscriber,
      },
      text: event.text.slice(0, 300),
    };
    this.chat.push(line);
    if (this.chat.length > CHAT_HISTORY) this.chat.shift();
    return line;
  }

  private chatVisible(overlay: OverlayConfig, line: ChatLine): boolean {
    const opts = ChatOverlayOptionsSchema.parse(overlay.options);
    return !(opts.hideCommands && line.text.trimStart().startsWith('!'));
  }

  private recordFollower(event: Extract<LiveEvent, { type: 'follow' | 'subscribe' }>): RecentFollower {
    const entry: RecentFollower = {
      id: event.id,
      platform: event.platform,
      kind: event.type,
      displayName: event.user.displayName,
      ...(event.user.avatarUrl ? { avatarUrl: event.user.avatarUrl } : {}),
    };
    this.recent.unshift(entry);
    if (this.recent.length > RECENT_HISTORY) this.recent.pop();
    return entry;
  }

  private scheduleViewers(): void {
    if (this.viewersTimer) return;
    this.viewersTimer = setTimeout(() => {
      this.viewersTimer = null;
      for (const o of this.overlays()) {
        if (o.kind === 'viewers') for (const m of this.stateFor(o)) this.send(o.id, m);
      }
    }, this.throttleMs);
  }

  private scheduleDonors(): void {
    if (this.donorsTimer) return;
    this.donorsTimer = setTimeout(() => {
      this.donorsTimer = null;
      for (const o of this.overlays()) {
        if (o.kind === 'top-donors') for (const m of this.stateFor(o)) this.send(o.id, m);
      }
    }, this.throttleMs);
  }

  private stateFor(overlay: OverlayConfig): OverlayServerMessage[] {
    switch (overlay.kind) {
      case 'top-donors': {
        const opts = TopDonorsOverlayOptionsSchema.parse(overlay.options);
        return [{ type: 'topDonors', donors: this.stats.topDonors(opts.limit) }];
      }
      case 'like-goal': {
        const opts = LikeGoalOverlayOptionsSchema.parse(overlay.options);
        const total = this.stats.get().likes;
        return [{ type: 'likes', total, goal: effectiveLikeGoal(total, opts.goal, opts.autoIncrement) }];
      }
      case 'chat': {
        const opts = ChatOverlayOptionsSchema.parse(overlay.options);
        const lines = this.chat.filter((l) => this.chatVisible(overlay, l)).slice(-opts.maxMessages);
        return [{ type: 'chat', lines, replace: true }];
      }
      case 'viewers': {
        const s = this.stats.get();
        return [{ type: 'viewers', viewers: s.viewers, likes: s.likes }];
      }
      case 'timer': {
        const st = this.timerState(overlay);
        return [{ type: 'timer', running: st.startedAt !== null, remainingMs: this.remaining(st) }];
      }
      case 'recent-followers': {
        const opts = RecentFollowersOverlayOptionsSchema.parse(overlay.options);
        const users = this.recent
          .filter((u) => opts.includeSubscribers || u.kind === 'follow')
          .slice(0, opts.limit);
        return [{ type: 'recentFollowers', users }];
      }
      default:
        return [];
    }
  }

  private alertFor(overlay: OverlayConfig, event: LiveEvent): OverlayServerMessage | null {
    const opts = AlertsOverlayOptionsSchema.parse(overlay.options);
    const user = (u: { username: string; displayName: string; avatarUrl?: string | undefined }) => ({
      username: u.username,
      displayName: u.displayName,
      ...(u.avatarUrl ? { avatarUrl: u.avatarUrl } : {}),
    });
    switch (event.type) {
      case 'gift': {
        // Alerts show one card per streak with its total, whatever the streak mode.
        const key = `${overlay.id}|${event.streakId ?? event.id}`;
        const count = (this.streakTotals.get(key) ?? 0) + event.count;
        if (!event.streakFinal) {
          this.streakTotals.set(key, count);
          if (this.streakTotals.size > 1000) this.streakTotals.clear();
          return null;
        }
        this.streakTotals.delete(key);
        if (event.gift.diamonds * count < opts.minDiamonds) return null;
        return {
          type: 'alert',
          alert: { id: makeId('alr'), kind: 'gift', user: user(event.user), gift: event.gift, count },
        };
      }
      case 'follow':
        return opts.showFollows
          ? { type: 'alert', alert: { id: makeId('alr'), kind: 'follow', user: user(event.user) } }
          : null;
      case 'share':
        return opts.showShares
          ? { type: 'alert', alert: { id: makeId('alr'), kind: 'share', user: user(event.user) } }
          : null;
      case 'subscribe':
        return opts.showSubscribes
          ? { type: 'alert', alert: { id: makeId('alr'), kind: 'subscribe', user: user(event.user) } }
          : null;
      default:
        return null;
    }
  }
}
