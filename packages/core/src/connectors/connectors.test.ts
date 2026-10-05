import type { LiveEvent, LiveUser } from '@toktok/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GiftAggregator, type GiftObservation } from '../gifts/aggregator';
import { SimulatorConnector } from './simulator/simulator';
import { mapChat, mapGiftList, mapGiftObservation, mapLike, mapUser } from './tiktok/mapper';
import { normalizeUsername, TikTokConnector, type TikTokClientLike } from './tiktok/tiktok-connector';
import { Backoff, type ConnectorStatusInfo } from './types';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const u: LiveUser = {
  id: '1',
  username: 'a',
  displayName: 'A',
  isModerator: false,
  isSubscriber: false,
  isFollower: false,
};
const obs = (
  repeatCount: number,
  repeatEnd: boolean,
  over: Partial<GiftObservation> = {},
): GiftObservation => ({
  platform: 'tiktok',
  user: u,
  gift: { id: 'rose', name: 'Rose', diamonds: 1 },
  repeatCount,
  repeatEnd,
  streakable: true,
  streakKey: 'k1',
  ...over,
});
const gifts = (events: LiveEvent[]) =>
  events.flatMap((e) => (e.type === 'gift' ? [[e.count, e.streakFinal] as const] : []));

describe('GiftAggregator', () => {
  it('end mode: counts a streak once with the final count', () => {
    const out: LiveEvent[] = [];
    const agg = new GiftAggregator((e) => out.push(e), 'end');
    for (let i = 1; i <= 5; i++) agg.push(obs(i, false));
    agg.push(obs(5, true));
    agg.push(obs(5, true)); // duplicate end
    expect(gifts(out)).toEqual([[5, true]]);
  });

  it('repeat mode: emits deltas while the streak runs', () => {
    const out: LiveEvent[] = [];
    const agg = new GiftAggregator((e) => out.push(e), 'repeat');
    agg.push(obs(1, false));
    agg.push(obs(3, false));
    agg.push(obs(3, false));
    agg.push(obs(4, true));
    expect(gifts(out)).toEqual([
      [1, false],
      [2, false],
      [1, true],
    ]);
  });

  it('closes stale streaks that never received an end message', () => {
    const out: LiveEvent[] = [];
    const agg = new GiftAggregator((e) => out.push(e), 'end', 1000);
    agg.push(obs(1, false));
    agg.push(obs(7, false));
    vi.advanceTimersByTime(999);
    expect(out).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(gifts(out)).toEqual([[7, true]]);
  });

  it('emits non-streakable gifts immediately', () => {
    const out: LiveEvent[] = [];
    const agg = new GiftAggregator((e) => out.push(e), 'end');
    agg.push(obs(1, false, { streakable: false }));
    expect(gifts(out)).toEqual([[1, true]]);
  });
});

describe('TikTok mapper', () => {
  it('maps v2 (proto v3) gift messages', () => {
    const o = mapGiftObservation({
      common: { msgId: 'm1', createTime: '1700000000000' },
      giftId: '5655',
      repeatCount: 3,
      repeatEnd: 1,
      groupId: '99',
      user: { id: '42', displayId: 'bob', nickname: 'Bobby', avatarThumb: { urlList: ['http://img'] } },
      userIdentity: { isModeratorOfAnchor: true },
      gift: { id: '5655', name: 'Rose', diamondCount: 1, type: 1, image: { urlList: ['http://rose'] } },
    });
    expect(o.user).toMatchObject({
      id: '42',
      username: 'bob',
      displayName: 'Bobby',
      isModerator: true,
      avatarUrl: 'http://img',
    });
    expect(o.gift).toEqual({ id: '5655', name: 'Rose', diamonds: 1, imageUrl: 'http://rose' });
    expect(o).toMatchObject({ repeatCount: 3, repeatEnd: true, streakable: true, streakKey: '42:5655:99' });
  });

  it('maps legacy field names and falls back to the catalog', () => {
    const o = mapGiftObservation(
      {
        giftId: 7,
        repeatCount: 1,
        repeatEnd: false,
        user: { userId: '1', uniqueId: 'al' },
        giftDetails: { giftType: 2 },
      },
      (id) => (id === '7' ? { id: '7', name: 'Cached', diamonds: 10 } : undefined),
    );
    expect(o.gift).toEqual({ id: '7', name: 'Cached', diamonds: 10 });
    expect(o.streakable).toBe(false);
    expect(mapUser({ uniqueId: 'x' }).username).toBe('x');
  });

  it('maps chat and likes', () => {
    expect(mapChat({ user: { uniqueId: 'a' }, comment: 'hi' })).toMatchObject({ type: 'chat', text: 'hi' });
    expect(mapChat({ user: { displayId: 'a' }, content: 'yo' })).toMatchObject({ text: 'yo' });
    expect(mapLike({ user: { displayId: 'a' }, count: 15, total: '1200' })).toMatchObject({
      count: 15,
      total: 1200,
    });
  });

  it('maps gift lists defensively', () => {
    expect(
      mapGiftList([{ id: 1, name: 'Rose', diamond_count: 1, image: { url_list: ['u'] } }, { nope: true }]),
    ).toEqual([{ id: '1', name: 'Rose', diamonds: 1, imageUrl: 'u' }]);
    expect(mapGiftList(null)).toEqual([]);
  });

  it('normalizes usernames', () => {
    expect(normalizeUsername(' @Foo.bar ')).toBe('Foo.bar');
    expect(normalizeUsername('https://www.tiktok.com/@foo/live')).toBe('foo');
  });
});

class FakeClient implements TikTokClientLike {
  handlers = new Map<string, ((...a: unknown[]) => void)[]>();
  constructor(public behavior: 'ok' | 'offline' | 'fail') {}
  on(event: string, l: (...a: unknown[]) => void) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), l]);
    return this;
  }
  removeAllListeners() {
    this.handlers.clear();
    return this;
  }
  fire(event: string, ...args: unknown[]) {
    for (const h of this.handlers.get(event) ?? []) h(...args);
  }
  async connect() {
    if (this.behavior === 'offline') {
      const e = new Error("The requested user isn't online :(");
      e.name = 'UserOfflineError';
      throw e;
    }
    if (this.behavior === 'fail') throw new Error('socket hang up');
    return {};
  }
  async disconnect() {
    this.fire('disconnected', { code: 1000 });
  }
}

describe('TikTokConnector', () => {
  function setup(behaviors: ('ok' | 'offline' | 'fail')[]) {
    const clients: FakeClient[] = [];
    const events: LiveEvent[] = [];
    const statuses: ConnectorStatusInfo[] = [];
    const connector = new TikTokConnector({
      createClient: () => {
        const c = new FakeClient(behaviors[Math.min(clients.length, behaviors.length - 1)]!);
        clients.push(c);
        return c;
      },
      offlinePollMs: 30_000,
      backoff: new Backoff(1000, 8000, () => 0),
    });
    connector.on('event', (e) => events.push(e));
    connector.on('status', (s) => statuses.push(s));
    return { connector, clients, events, statuses };
  }

  it('connects, forwards events and aggregates gift streaks', async () => {
    const { connector, clients, events } = setup(['ok']);
    await connector.connect('@me');
    expect(connector.getStatus().status).toBe('connected');
    const c = clients[0]!;
    c.fire('chat', { user: { displayId: 'v' }, content: '!tnt' });
    const g = {
      giftId: '1',
      user: { id: '9', displayId: 'v' },
      gift: { name: 'Rose', diamondCount: 1, type: 1 },
    };
    c.fire('gift', { ...g, repeatCount: 1, repeatEnd: 0 });
    c.fire('gift', { ...g, repeatCount: 2, repeatEnd: 1 });
    expect(events.map((e) => e.type)).toEqual(['connected', 'chat', 'gift']);
    expect(events[2]).toMatchObject({ count: 2 });
  });

  it('reconnects with backoff after a lost connection', async () => {
    const { connector, clients, events } = setup(['ok', 'fail', 'ok']);
    await connector.connect('me');
    clients[0]!.fire('disconnected', { code: 1006 });
    expect(events.at(-1)).toMatchObject({ type: 'disconnected', liveEnded: false });
    expect(connector.getStatus().status).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(500); // backoff #1 = 500ms with random()=0
    expect(clients).toHaveLength(2);
    expect(connector.getStatus().status).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(1000); // backoff #2
    expect(clients).toHaveLength(3);
    expect(connector.getStatus().status).toBe('connected');
  });

  it('detects the end of the live and waits for the next one', async () => {
    const { connector, clients, events } = setup(['ok', 'offline', 'ok']);
    await connector.connect('me');
    clients[0]!.fire('streamEnd', { action: 3 });
    clients[0]!.fire('disconnected', { code: 4005 });
    expect(events.at(-1)).toMatchObject({ type: 'disconnected', liveEnded: true });
    expect(connector.getStatus().status).toBe('waiting-live');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(connector.getStatus().status).toBe('waiting-live');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(connector.getStatus().status).toBe('connected');
  });

  it('stops everything on manual disconnect', async () => {
    const { connector, clients } = setup(['offline']);
    await connector.connect('me');
    expect(connector.getStatus().status).toBe('waiting-live');
    await connector.disconnect();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(clients).toHaveLength(1);
    expect(connector.getStatus().status).toBe('idle');
  });

  it('rejects invalid usernames', async () => {
    const { connector } = setup(['ok']);
    await expect(connector.connect('bad name!')).rejects.toThrow();
  });
});

describe('SimulatorConnector', () => {
  it('plays gift streaks through the aggregator', async () => {
    const sim = new SimulatorConnector();
    const events: LiveEvent[] = [];
    sim.on('event', (e) => events.push(e));
    await sim.connect();
    sim.gift('5655', 5);
    sim.like(20);
    await vi.runAllTimersAsync();
    expect(events.map((e) => e.type)).toEqual(['connected', 'like', 'gift']);
    expect(events[2]).toMatchObject({ count: 5, streakFinal: true });
  });
});
