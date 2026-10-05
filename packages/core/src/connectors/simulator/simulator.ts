import { makeId, type GiftInfo, type LiveEvent, type LiveUser } from '@toktok/shared';
import { GiftAggregator, type StreakMode } from '../../gifts/aggregator';
import { BaseConnector } from '../types';

/** Gifts used when no real catalog is cached yet (values are illustrative). */
export const SIMULATOR_GIFTS: GiftInfo[] = [
  { id: '5655', name: 'Rose', diamonds: 1 },
  { id: 'sim-heart', name: 'Heart', diamonds: 5 },
  { id: 'sim-donut', name: 'Donut', diamonds: 30 },
  { id: 'sim-cap', name: 'Cap', diamonds: 99 },
  { id: 'sim-rocket', name: 'Rocket', diamonds: 500 },
  { id: 'sim-lion', name: 'Lion', diamonds: 29_999 },
];

const NAMES = ['luna', 'max_gaming', 'zoe.play', 'kenji', 'ines_42', 'tom.builder', 'sara', 'noah_live'];

export interface SimulatedUserInput {
  username?: string;
  isModerator?: boolean;
  isSubscriber?: boolean;
  isFollower?: boolean;
}

export function simulatedUser(input: SimulatedUserInput = {}): LiveUser {
  const username = input.username?.trim() || NAMES[Math.floor(Math.random() * NAMES.length)]!;
  return {
    id: `sim-${username}`,
    username,
    displayName: username,
    isModerator: input.isModerator ?? false,
    isSubscriber: input.isSubscriber ?? false,
    isFollower: input.isFollower ?? true,
  };
}

/**
 * Fake live used by the "Tester" button: emits the same normalized events as a
 * real platform, including gift streaks (so the streak logic is exercised too).
 */
export class SimulatorConnector extends BaseConnector {
  readonly platform = 'simulator' as const;
  private readonly aggregator: GiftAggregator;
  private totalLikes = 0;
  private timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(
    private readonly gifts: () => GiftInfo[] = () => SIMULATOR_GIFTS,
    streakMode: StreakMode = 'end',
  ) {
    super();
    this.aggregator = new GiftAggregator((e) => this.emit('event', e), streakMode, 3000);
  }

  setStreakMode(mode: StreakMode): void {
    this.aggregator.setMode(mode);
  }

  async connect(channel = 'simulateur'): Promise<void> {
    this.totalLikes = 0;
    this.setStatus({ status: 'connected', channel });
    this.push({ type: 'connected', channel });
  }

  async disconnect(): Promise<void> {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.aggregator.flushAll();
    if (this.statusInfo.status === 'connected') this.push({ type: 'disconnected', reason: 'manual', liveEnded: false });
    this.setStatus({ status: 'idle', channel: null });
  }

  async fetchGifts(): Promise<GiftInfo[]> {
    return this.gifts();
  }

  /** Sends a gift. A streakable gift with count > 1 is played as a streak (one message every 150ms). */
  gift(giftId: string, count = 1, user: LiveUser = simulatedUser()): void {
    const gift = this.gifts().find((g) => g.id === giftId) ?? SIMULATOR_GIFTS[0]!;
    const streakable = gift.diamonds < 100;
    const key = `${user.id}:${gift.id}:${makeId('grp')}`;
    if (!streakable || count === 1) {
      this.aggregator.push({
        platform: 'simulator',
        user,
        gift,
        repeatCount: count,
        repeatEnd: true,
        streakable,
        streakKey: key,
      });
      return;
    }
    for (let i = 1; i <= count; i++) {
      this.later((i - 1) * 150, () =>
        this.aggregator.push({
          platform: 'simulator',
          user,
          gift,
          repeatCount: i,
          repeatEnd: false,
          streakable: true,
          streakKey: key,
        }),
      );
    }
    this.later(count * 150, () =>
      this.aggregator.push({
        platform: 'simulator',
        user,
        gift,
        repeatCount: count,
        repeatEnd: true,
        streakable: true,
        streakKey: key,
      }),
    );
  }

  like(count = 15, user: LiveUser = simulatedUser()): void {
    this.totalLikes += count;
    this.push({ type: 'like', user, count, total: this.totalLikes });
  }

  follow(user: LiveUser = simulatedUser()): void {
    this.push({ type: 'follow', user });
  }

  share(user: LiveUser = simulatedUser()): void {
    this.push({ type: 'share', user });
  }

  subscribe(user: LiveUser = simulatedUser({ isSubscriber: true })): void {
    this.push({ type: 'subscribe', user, months: 1 });
  }

  chat(text: string, user: LiveUser = simulatedUser()): void {
    this.push({ type: 'chat', user, text });
  }

  viewers(count: number): void {
    this.push({ type: 'viewerCount', count });
  }

  /** Random burst of activity for load testing (duration in ms). */
  rain(durationMs = 10_000): void {
    const steps = Math.floor(durationMs / 250);
    for (let i = 0; i < steps; i++) {
      this.later(i * 250, () => {
        const r = Math.random();
        const gifts = this.gifts();
        if (r < 0.35 && gifts.length) {
          const g = gifts[Math.floor(Math.random() * Math.min(gifts.length, 4))]!;
          this.gift(g.id, 1 + Math.floor(Math.random() * 5));
        } else if (r < 0.75) this.like(5 + Math.floor(Math.random() * 30));
        else if (r < 0.85) this.follow();
        else this.chat(Math.random() < 0.5 ? '!tnt' : 'gg');
      });
    }
  }

  private later(ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }

  private push(partial: DistributiveOmit<LiveEvent, 'id' | 'platform' | 'timestamp'>): void {
    this.emit('event', { ...partial, id: makeId('sim'), platform: 'simulator', timestamp: Date.now() } as LiveEvent);
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
