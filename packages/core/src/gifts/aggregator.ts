import { makeId, type GiftInfo, type LiveEvent, type LiveUser, type Platform } from '@toktok/shared';

/**
 * end    -> one event per streak, emitted when the streak ends (with the final count)
 * repeat -> one event per increment while the streak is running (count = delta)
 */
export type StreakMode = 'end' | 'repeat';

export interface GiftObservation {
  platform: Platform;
  user: LiveUser;
  gift: GiftInfo;
  /** Cumulated units of the current streak (TikTok repeatCount). */
  repeatCount: number;
  /** Platform says the streak is over. */
  repeatEnd: boolean;
  /** Streakable (combo) gift. Non-streakable gifts are emitted immediately. */
  streakable: boolean;
  /** Identifies the streak (user + gift + group id). */
  streakKey: string;
}

interface OpenStreak {
  id: string;
  last: number;
  emitted: number;
  obs: GiftObservation;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Turns raw gift messages into normalized gift events, handling combos/streaks
 * so that a streak of 10 roses is never counted 1+2+3+...+10 times.
 */
export class GiftAggregator {
  private readonly open = new Map<string, OpenStreak>();
  /** Recently closed streaks, to drop duplicated "end" messages. */
  private readonly closed = new Map<string, number>();

  constructor(
    private readonly emit: (event: LiveEvent) => void,
    private mode: StreakMode = 'end',
    /** A streak with no news for this long is considered finished. */
    private readonly staleMs = 8000,
  ) {}

  setMode(mode: StreakMode): void {
    this.flushAll();
    this.mode = mode;
  }

  push(obs: GiftObservation): void {
    const count = Math.max(1, Math.floor(obs.repeatCount || 1));
    if (!obs.streakable) {
      this.emitGift(obs, count, makeId('stk'), true);
      return;
    }
    const closedAt = this.closed.get(obs.streakKey);
    if (closedAt !== undefined) {
      if (obs.repeatEnd) return; // duplicate end message
      this.closed.delete(obs.streakKey); // same key reused for a new streak
    }

    let streak = this.open.get(obs.streakKey);
    if (!streak) {
      streak = { id: makeId('stk'), last: 0, emitted: 0, obs, timer: this.armTimer(obs.streakKey) };
      this.open.set(obs.streakKey, streak);
    } else {
      clearTimeout(streak.timer);
      streak.timer = this.armTimer(obs.streakKey);
    }
    streak.last = Math.max(streak.last, count);
    streak.obs = obs;

    if (this.mode === 'repeat') {
      const delta = streak.last - streak.emitted;
      if (delta > 0) {
        streak.emitted = streak.last;
        this.emitGift(obs, delta, streak.id, obs.repeatEnd);
      }
    }
    if (obs.repeatEnd) this.close(obs.streakKey);
  }

  /** Ends every open streak now (disconnect, mode change). */
  flushAll(): void {
    for (const key of [...this.open.keys()]) this.close(key);
  }

  dispose(): void {
    for (const s of this.open.values()) clearTimeout(s.timer);
    this.open.clear();
    this.closed.clear();
  }

  private armTimer(key: string) {
    return setTimeout(() => this.close(key), this.staleMs);
  }

  private close(key: string): void {
    const streak = this.open.get(key);
    if (!streak) return;
    clearTimeout(streak.timer);
    this.open.delete(key);
    this.closed.set(key, Date.now());
    if (this.closed.size > 500) {
      const oldest = this.closed.keys().next().value;
      if (oldest !== undefined) this.closed.delete(oldest);
    }
    if (this.mode === 'end') {
      this.emitGift(streak.obs, streak.last, streak.id, true);
    } else if (streak.last > streak.emitted) {
      this.emitGift(streak.obs, streak.last - streak.emitted, streak.id, true);
      streak.emitted = streak.last;
    }
  }

  private emitGift(obs: GiftObservation, count: number, streakId: string, final: boolean): void {
    this.emit({
      id: makeId('gift'),
      platform: obs.platform,
      timestamp: Date.now(),
      type: 'gift',
      user: obs.user,
      gift: obs.gift,
      count,
      streakId,
      streakFinal: final,
    });
  }
}
