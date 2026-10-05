import { contextFromEvent, EffectSchema, type LiveEvent } from '@toktok/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GamepadIntegration, parsePadScript, type GamepadDriver } from './gamepad';

const ctx = contextFromEvent({
  id: 'e',
  platform: 'simulator',
  timestamp: 0,
  type: 'follow',
  user: {
    id: '1',
    username: 'u',
    displayName: 'U',
    isModerator: false,
    isSubscriber: false,
    isFollower: true,
  },
} as LiveEvent);
const fx = (effectId: string, params: Record<string, unknown>) =>
  EffectSchema.parse({ integrationId: 'g', effectId, params });

function fakeDriver() {
  const log: string[] = [];
  const driver: GamepadDriver = {
    createController: (type) => {
      log.push(`plug ${type}`);
      return {
        setButton: (n, p) => log.push(`${p ? 'down' : 'up'} ${n}`),
        setAxis: (n, v) => log.push(`${n}=${v}`),
        reset: () => log.push('reset'),
        disconnect: () => log.push('unplug'),
      };
    },
  };
  return { log, driver };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('gamepad', () => {
  it('parses scripts with friendly button names per controller', () => {
    expect(parsePadScript('press a 100\nstick left 0 1 500\ndpad up\ntrigger right 1', 'x360')).toEqual([
      { op: 'press', button: 'A', ms: 100 },
      { op: 'stick', side: 'left', x: 0, y: 1, ms: 500 },
      { op: 'dpad', dir: 'up', ms: 150 },
      { op: 'trigger', side: 'right', value: 1, ms: 300 },
    ]);
    expect(
      parsePadScript('press cross\npress a', 'ds4').map((s) => (s.op === 'press' ? s.button : '')),
    ).toEqual(['CROSS', 'CROSS']);
    expect(() => parsePadScript('press cross', 'x360')).toThrow(/bouton inconnu/);
    expect(() => parsePadScript('stick left 2 0', 'x360')).toThrow(/entre -1 et 1/);
  });

  it('plugs the controller lazily, plays steps and always resets', async () => {
    const { log, driver } = fakeDriver();
    const pad = new GamepadIntegration({ controller: 'x360' }, driver);
    const p = pad.execute(
      fx('pad.sequence', { script: 'press a 100\nstick left 0 1 200' }),
      ctx,
      new AbortController().signal,
    );
    await vi.runAllTimersAsync();
    await p;
    expect(log).toEqual(['plug x360', 'down A', 'up A', 'leftX=0', 'leftY=1', 'leftX=0', 'leftY=0', 'reset']);
    expect(pad.status().state).toBe('connected');
  });

  it('resets on abort and reports a missing driver', async () => {
    const { log, driver } = fakeDriver();
    const pad = new GamepadIntegration({ controller: 'x360' }, driver);
    const ctrl = new AbortController();
    const p = pad.execute(fx('pad.sequence', { script: 'down rb\nwait 5000' }), ctx, ctrl.signal);
    const assertion = expect(p).rejects.toThrow('aborted');
    await vi.advanceTimersByTimeAsync(10);
    ctrl.abort();
    await assertion;
    expect(log.at(-1)).toBe('reset');

    const missing = new GamepadIntegration({ controller: 'x360' }, undefined);
    expect(missing.status().state).toBe('error');
    await expect(
      missing.execute(fx('pad.press', { button: 'a' }), ctx, new AbortController().signal),
    ).rejects.toThrow(/ViGEmBus/);
  });
});
