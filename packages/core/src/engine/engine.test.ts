import {
  ActionSchema,
  type ActionInput,
  type JournalEntry,
  type LiveEvent,
  type LiveUser,
} from '@toktok/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionEngine, type EffectRunner } from './engine';
import { parseCommand, passesUserFilter } from './matcher';

const user = (over: Partial<LiveUser> = {}): LiveUser => ({
  id: 'u1',
  username: 'alice',
  displayName: 'Alice',
  isModerator: false,
  isSubscriber: false,
  isFollower: false,
  ...over,
});

let seq = 0;
const base = () => ({ id: `e${seq++}`, platform: 'simulator' as const, timestamp: 0 });
const gift = (giftId: string, count: number, diamonds = 1, u = user()): LiveEvent => ({
  ...base(),
  type: 'gift',
  user: u,
  gift: { id: giftId, name: `G${giftId}`, diamonds },
  count,
  streakFinal: true,
});
const like = (count: number, u = user()): LiveEvent => ({
  ...base(),
  type: 'like',
  user: u,
  count,
  total: 0,
});
const chat = (text: string, u = user()): LiveEvent => ({ ...base(), type: 'chat', user: u, text });

const action = (over: Partial<ActionInput> & Pick<ActionInput, 'trigger'>) =>
  ActionSchema.parse({
    id: over.id ?? `a${seq++}`,
    profileId: 'p',
    name: over.name ?? 'test',
    effects: over.effects ?? [{ integrationId: 'i', effectId: 'fx', params: {} }],
    ...over,
  });

interface Harness {
  engine: ActionEngine;
  calls: { effectId: string; count: number; username: string }[];
  journal: JournalEntry[];
  runner: EffectRunner & { delay: number };
}

function harness(opts: { concurrency?: number; maxPerSecond?: number; maxQueue?: number } = {}): Harness {
  const calls: Harness['calls'] = [];
  const journal: JournalEntry[] = [];
  const runner = {
    delay: 0,
    async run(effect: { effectId: string }, ctx: { count: number; username: string }, signal: AbortSignal) {
      calls.push({ effectId: effect.effectId, count: ctx.count, username: ctx.username });
      if (runner.delay > 0) {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, runner.delay);
          signal.addEventListener('abort', () => {
            clearTimeout(t);
            reject(new Error('aborted'));
          });
        });
      }
    },
  };
  const engine = new ActionEngine({ runner, journal: (e) => journal.push(e), ...opts });
  return { engine, calls, journal, runner };
}

const statuses = (j: JournalEntry[]) =>
  j.flatMap((e) => (e.kind === 'action' ? [e.status + (e.detail ? `:${e.detail}` : '')] : []));

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('matching', () => {
  it('matches a gift by id and respects minCount', async () => {
    const h = harness();
    h.engine.setActions([action({ trigger: { kind: 'gift', giftId: '1', minCount: 5 } })]);
    h.engine.handleEvent(gift('1', 4));
    h.engine.handleEvent(gift('2', 10));
    h.engine.handleEvent(gift('1', 5));
    await vi.runAllTimersAsync();
    expect(h.calls).toHaveLength(1);
  });

  it('matches diamonds thresholds on total value', async () => {
    const h = harness();
    h.engine.setActions([action({ trigger: { kind: 'diamonds', min: 100 } })]);
    h.engine.handleEvent(gift('1', 9, 10)); // 90
    h.engine.handleEvent(gift('1', 10, 10)); // 100
    await vi.runAllTimersAsync();
    expect(h.calls).toHaveLength(1);
  });

  it('supports diamond tiers with an upper bound', async () => {
    const h = harness();
    h.engine.setActions([action({ id: 'tier', trigger: { kind: 'diamonds', min: 10, max: 98 } })]);
    h.engine.handleEvent(gift('1', 5, 1)); // 5: below
    h.engine.handleEvent(gift('1', 10, 1)); // 10: in
    h.engine.handleEvent(gift('1', 1, 99)); // 99: above
    await vi.runAllTimersAsync();
    expect(h.calls).toHaveLength(1);
  });

  it('fires once per like threshold crossed', async () => {
    const h = harness();
    h.engine.setActions([action({ trigger: { kind: 'likes', every: 100 }, quantityMode: 'multiply' })]);
    h.engine.handleEvent(like(60));
    h.engine.handleEvent(like(60)); // 120 -> 1
    h.engine.handleEvent(like(250)); // 370 -> 2 more
    await vi.runAllTimersAsync();
    expect(h.calls).toHaveLength(3);
  });

  it('parses chat commands', () => {
    expect(parseCommand('!TNT')).toEqual({ name: 'tnt', args: '' });
    expect(parseCommand('  !tnt 3 now')).toEqual({ name: 'tnt', args: '3 now' });
    expect(parseCommand('tnt')).toBeNull();
    expect(parseCommand('!tnt!')).toBeNull();
  });

  it('matches commands and keywords', async () => {
    const h = harness();
    h.engine.setActions([
      action({ id: 'cmd', trigger: { kind: 'command', name: 'tnt' } }),
      action({ id: 'kw', trigger: { kind: 'keyword', text: 'GG' } }),
    ]);
    h.engine.handleEvent(chat('!tnt'));
    h.engine.handleEvent(chat('well gg everyone'));
    h.engine.handleEvent(chat('!tntx'));
    await vi.runAllTimersAsync();
    expect(h.calls).toHaveLength(2);
  });
});

describe('quantity', () => {
  it('multiplies by gift count with a cap', async () => {
    const h = harness();
    h.engine.setActions([
      action({ trigger: { kind: 'gift', giftId: '1' }, quantityMode: 'multiply', maxMultiplier: 3 }),
    ]);
    h.engine.handleEvent(gift('1', 10));
    await vi.runAllTimersAsync();
    expect(h.calls).toHaveLength(3);
    expect(h.calls.every((c) => c.count === 1)).toBe(true);
  });

  it('runs once with the full count in "once" mode', async () => {
    const h = harness();
    h.engine.setActions([action({ trigger: { kind: 'gift', giftId: '1' } })]);
    h.engine.handleEvent(gift('1', 10));
    await vi.runAllTimersAsync();
    expect(h.calls).toEqual([{ effectId: 'fx', count: 10, username: 'alice' }]);
  });
});

describe('filters & cooldowns', () => {
  it('applies user filters', () => {
    const f = {
      moderatorsOnly: true,
      subscribersOnly: false,
      followersOnly: false,
      allowList: ['vip'],
      denyList: ['troll'],
    };
    expect(passesUserFilter(f, user())).toBe(false);
    expect(passesUserFilter(f, user({ isModerator: true }))).toBe(true);
    expect(passesUserFilter(f, user({ username: 'VIP' }))).toBe(true);
    expect(passesUserFilter(f, user({ username: 'troll', isModerator: true }))).toBe(false);
    expect(passesUserFilter(f, undefined)).toBe(false);
  });

  it('enforces global and per-user cooldowns', async () => {
    const h = harness();
    h.engine.setActions([
      action({ id: 'g', trigger: { kind: 'follow' }, cooldownMs: 1000 }),
      action({ id: 'u', trigger: { kind: 'share' }, userCooldownMs: 1000 }),
    ]);
    const follow = (): LiveEvent => ({ ...base(), type: 'follow', user: user() });
    const share = (id: string): LiveEvent => ({ ...base(), type: 'share', user: user({ id }) });
    h.engine.handleEvent(follow());
    h.engine.handleEvent(follow());
    h.engine.handleEvent(share('a'));
    h.engine.handleEvent(share('a'));
    h.engine.handleEvent(share('b'));
    await vi.advanceTimersByTimeAsync(1001);
    h.engine.handleEvent(follow());
    await vi.runAllTimersAsync();
    expect(h.calls).toHaveLength(4);
    expect(statuses(h.journal).filter((s) => s.startsWith('skipped'))).toEqual([
      'skipped:cooldown',
      'skipped:cooldown viewer',
    ]);
  });
});

describe('queue', () => {
  it('runs jobs of the same action sequentially, by priority across actions', async () => {
    const h = harness({ concurrency: 1 });
    h.runner.delay = 100;
    h.engine.setActions([
      action({
        id: 'low',
        trigger: { kind: 'gift', giftId: 'low' },
        priority: 1,
        effects: [{ integrationId: 'i', effectId: 'low' }],
      }),
      action({
        id: 'high',
        trigger: { kind: 'gift', giftId: 'high' },
        priority: 9,
        effects: [{ integrationId: 'i', effectId: 'high' }],
      }),
    ]);
    h.engine.handleEvent(gift('low', 1)); // starts immediately
    h.engine.handleEvent(gift('low', 1));
    h.engine.handleEvent(gift('high', 1)); // jumps ahead of the pending low
    await vi.runAllTimersAsync();
    expect(h.calls.map((c) => c.effectId)).toEqual(['low', 'high', 'low']);
  });

  it('skips when busy with the "skip" policy', async () => {
    const h = harness();
    h.runner.delay = 500;
    h.engine.setActions([action({ trigger: { kind: 'gift', giftId: '1' }, busyPolicy: 'skip' })]);
    h.engine.handleEvent(gift('1', 1));
    h.engine.handleEvent(gift('1', 1));
    await vi.runAllTimersAsync();
    expect(h.calls).toHaveLength(1);
    expect(statuses(h.journal)).toContain('skipped:action occupée');
  });

  it('rate-limits job starts', async () => {
    const h = harness({ maxPerSecond: 2, concurrency: 10 });
    const acts = [0, 1, 2, 3].map((i) => action({ id: `r${i}`, trigger: { kind: 'follow' } }));
    h.engine.setActions(acts);
    h.engine.handleEvent({ ...base(), type: 'follow', user: user() });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.calls).toHaveLength(4);
  });

  it('drops jobs when the queue is full', async () => {
    const h = harness({ maxQueue: 2, concurrency: 1 });
    h.runner.delay = 100;
    h.engine.setActions([
      action({ trigger: { kind: 'gift', giftId: '1' }, quantityMode: 'multiply', maxMultiplier: 10 }),
    ]);
    h.engine.handleEvent(gift('1', 5));
    await vi.runAllTimersAsync();
    expect(h.calls).toHaveLength(2);
    expect(statuses(h.journal).filter((s) => s === 'skipped:file pleine')).toHaveLength(3);
  });

  it('clearQueue drops pending and aborts running jobs', async () => {
    const h = harness({ concurrency: 1 });
    h.runner.delay = 1000;
    h.engine.setActions([action({ trigger: { kind: 'gift', giftId: '1' }, quantityMode: 'multiply' })]);
    h.engine.handleEvent(gift('1', 3));
    await vi.advanceTimersByTimeAsync(10);
    h.engine.clearQueue();
    await vi.runAllTimersAsync();
    expect(h.calls).toHaveLength(1);
    expect(h.engine.stats()).toEqual({ pending: 0, running: 0 });
    expect(statuses(h.journal)).toContain('skipped:annulé');
  });

  it('honours effect delay and repeat, and reports failures without stopping', async () => {
    const calls: number[] = [];
    const journal: JournalEntry[] = [];
    const engine = new ActionEngine({
      journal: (e) => journal.push(e),
      runner: {
        async run(effect) {
          calls.push(Date.now());
          if (effect.effectId === 'boom') throw new Error('RCON down');
        },
      },
    });
    const start = Date.now();
    engine.setActions([
      action({
        trigger: { kind: 'follow' },
        effects: [
          { integrationId: 'i', effectId: 'boom' },
          { integrationId: 'i', effectId: 'ok', delayMs: 200, repeat: 3, repeatIntervalMs: 100 },
        ],
      }),
    ]);
    engine.handleEvent({ ...base(), type: 'follow', user: user() });
    await vi.runAllTimersAsync();
    expect(calls.map((t) => t - start)).toEqual([0, 200, 300, 400]);
    expect(statuses(journal).at(-1)).toBe('failed:boom: RCON down');
  });
});
