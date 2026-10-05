import {
  AlertsOverlayOptionsSchema,
  LikeGoalOverlayOptionsSchema,
  TopDonorsOverlayOptionsSchema,
  makeId,
  type LiveEvent,
  type OverlayConfig,
  type OverlayServerMessage,
} from '@toktok/shared';
import type { SessionTracker } from '../stats/session-tracker';

/** Goal shown by the like gauge: grows by `autoIncrement` steps once reached. */
export function effectiveLikeGoal(total: number, goal: number, autoIncrement: number): number {
  if (autoIncrement <= 0 || total < goal) return goal;
  return goal + (Math.floor((total - goal) / autoIncrement) + 1) * autoIncrement;
}

/**
 * Builds the messages each overlay needs from live events and session stats.
 */
export class OverlayFeeder {
  private donorsTimer: ReturnType<typeof setTimeout> | null = null;
  /** Units already received for running streaks ("repeat" mode sends deltas). */
  private readonly streakTotals = new Map<string, number>();

  constructor(
    private readonly overlays: () => OverlayConfig[],
    private readonly stats: SessionTracker,
    private readonly send: (overlayId: string, msg: OverlayServerMessage) => void,
    private readonly throttleMs = 400,
  ) {}

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
    for (const overlay of this.overlays()) {
      if (overlay.kind === 'alerts') {
        const alert = this.alertFor(overlay, event);
        if (alert) this.send(overlay.id, alert);
      }
    }
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
    this.donorsTimer = null;
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
