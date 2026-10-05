import type { LiveEvent, LiveUser, OverlayConfig, OverlayKind, OverlayServerMessage } from '@toktok/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../db/database';
import { SessionsRepo } from '../db/repositories';
import { SessionTracker } from '../stats/session-tracker';
import { OverlayFeeder, pickWeighted } from './overlay-feeder';

const style = {
  theme: 'default',
  primaryColor: '#ff0000',
  textColor: '#ffffff',
  fontFamily: 'x',
  fontSizePx: 20,
  animation: 'pop',
} as const;
const ov = (id: string, kind: OverlayKind, options: Record<string, unknown> = {}): OverlayConfig => ({
  id,
  kind,
  name: id.toUpperCase(),
  style,
  options,
});
const user: LiveUser = {
  id: '1',
  username: 'bob',
  displayName: 'Bob',
  isModerator: false,
  isSubscriber: true,
  isFollower: false,
};
const ev = (e: Record<string, unknown>) =>
  ({ id: Math.random().toString(36), platform: 'kick', timestamp: 0, ...e }) as LiveEvent;

let clock = 0;
beforeEach(() => {
  vi.useFakeTimers();
  clock = 0;
});
afterEach(() => vi.useRealTimers());

function setup(overlays: OverlayConfig[], random = () => 0) {
  const sent: [string, OverlayServerMessage][] = [];
  const results: string[] = [];
  const tracker = new SessionTracker(new SessionsRepo(openDatabase(':memory:')));
  const feeder = new OverlayFeeder(
    () => overlays,
    tracker,
    (id, m) => sent.push([id, m]),
    {
      throttleMs: 0,
      now: () => clock,
      random,
      onWheelResult: (_o, seg, ctx) => results.push(`${seg.label}:${ctx?.displayName ?? '-'}`),
    },
  );
  const of = <T extends OverlayServerMessage['type']>(type: T) =>
    sent
      .filter(([, m]) => m.type === type)
      .map(([id, m]) => [id, m] as [string, Extract<OverlayServerMessage, { type: T }>]);
  return { feeder, tracker, sent, results, of };
}

describe('OverlayFeeder (phase 3 overlays)', () => {
  it('streams chat lines, hides commands and replays the history on connect', () => {
    const { feeder, of } = setup([
      ov('c', 'chat', { maxMessages: 2 }),
      ov('c2', 'chat', { hideCommands: false }),
    ]);
    feeder.handle(ev({ type: 'chat', user, text: 'salut' }));
    feeder.handle(ev({ type: 'chat', user, text: '!tnt' }));
    feeder.handle(ev({ type: 'chat', user, text: 'gg' }));
    expect(
      of('chat')
        .filter(([id]) => id === 'c')
        .map(([, m]) => m.lines[0]!.text),
    ).toEqual(['salut', 'gg']);
    expect(of('chat').filter(([id]) => id === 'c2')).toHaveLength(3);
    const init = feeder.initialMessages('c').find((m) => m.type === 'chat');
    expect(init).toMatchObject({ replace: true, lines: [{ text: 'salut' }, { text: 'gg' }] });
    expect(init?.type === 'chat' && init.lines[0]!.platform).toBe('kick');
  });

  it('lists recent followers, optionally with subscribers', async () => {
    const { feeder, of } = setup([ov('f', 'recent-followers', { includeSubscribers: false, limit: 2 })]);
    feeder.handle(ev({ type: 'follow', user: { ...user, displayName: 'A' } }));
    feeder.handle(ev({ type: 'subscribe', user: { ...user, displayName: 'S' } }));
    feeder.handle(ev({ type: 'follow', user: { ...user, displayName: 'B' } }));
    feeder.handle(ev({ type: 'follow', user: { ...user, displayName: 'C' } }));
    expect(
      of('recentFollowers')
        .at(-1)?.[1]
        .users.map((u) => u.displayName),
    ).toEqual(['C', 'B']);
  });

  it('pushes viewers and likes (throttled)', async () => {
    const { feeder, tracker, of } = setup([ov('v', 'viewers')]);
    tracker.handle(ev({ type: 'connected', channel: 'x' }));
    tracker.handle(ev({ type: 'viewerCount', count: 42 }));
    feeder.handle(ev({ type: 'viewerCount', count: 42 }));
    feeder.handle(ev({ type: 'viewerCount', count: 42 }));
    await vi.advanceTimersByTimeAsync(1);
    expect(of('viewers')).toEqual([['v', { type: 'viewers', viewers: 42, likes: 0 }]]);
  });

  it('runs countdown timers: start, add with cap, pause, reset', () => {
    const { feeder, of } = setup([ov('t', 'timer', { initialSeconds: 60, maxSeconds: 100 })]);
    expect(feeder.initialMessages('t').at(-1)).toEqual({
      type: 'timer',
      running: false,
      remainingMs: 60_000,
    });
    expect(feeder.controlTimer('T', 'start')).toBe(1);
    clock = 10_000;
    feeder.controlTimer('*', 'add', 30);
    expect(of('timer').at(-1)?.[1]).toEqual({ type: 'timer', running: true, remainingMs: 80_000 });
    feeder.controlTimer('t', 'add', 500);
    expect(of('timer').at(-1)?.[1].remainingMs).toBe(100_000);
    clock = 20_000;
    feeder.controlTimer('t', 'pause');
    expect(of('timer').at(-1)?.[1]).toEqual({ type: 'timer', running: false, remainingMs: 90_000 });
    clock = 99_000;
    expect(feeder.initialMessages('t').at(-1)).toMatchObject({ remainingMs: 90_000 });
    feeder.controlTimer('t', 'reset');
    expect(of('timer').at(-1)?.[1].remainingMs).toBe(60_000);
    expect(feeder.controlTimer('unknown', 'start')).toBe(0);
  });

  it('spins wheels one after the other and reports results', async () => {
    const segments = [
      { label: 'A', weight: 1 },
      { label: 'B', weight: 3 },
    ];
    const { feeder, of, results } = setup([ov('w', 'wheel', { segments, spinMs: 2000 })], () => 0.5);
    feeder.spinWheel('w', { displayName: 'Ann' } as never);
    feeder.spinWheel('*');
    expect(of('wheelSpin')).toHaveLength(1);
    expect(of('wheelSpin')[0]![1].spin).toMatchObject({ index: 1, label: 'B', durationMs: 2000, by: 'Ann' });
    clock = 2000;
    await vi.advanceTimersByTimeAsync(2000);
    expect(results).toEqual(['B:Ann']);
    clock = 4500;
    await vi.advanceTimersByTimeAsync(2500);
    expect(of('wheelSpin')).toHaveLength(2);
    clock = 6500;
    await vi.advanceTimersByTimeAsync(2000);
    expect(results).toEqual(['B:Ann', 'B:-']);
    feeder.dispose();
  });

  it('picks weighted segments', () => {
    const segs = [{ weight: 1 }, { weight: 2 }, { weight: 1 }];
    expect([0, 0.24, 0.25, 0.74, 0.75, 0.999].map((r) => pickWeighted(segs, r))).toEqual([0, 0, 1, 1, 2, 2]);
  });
});

describe('wheelSliceColor', () => {
  it('returns hex colors spread around the wheel', async () => {
    const { wheelSliceColor } = await import('@toktok/shared');
    expect(wheelSliceColor(0, 4)).toMatch(/^#[0-9a-f]{6}$/);
    expect(new Set([0, 1, 2, 3].map((i) => wheelSliceColor(i, 4))).size).toBe(4);
    expect(wheelSliceColor(0, 3)).toBe('#e44444');
  });
});
