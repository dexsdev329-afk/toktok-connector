import { contextFromEvent, EffectSchema, type LiveEvent } from '@toktok/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InputDriver } from './input/driver';
import { InputIntegration } from './input/input-integration';
import { parseInputScript } from './input/script';
import { IntegrationManager } from './manager';
import {
  MinecraftRconIntegration,
  RconConfigSchema,
  RCON_PRESETS,
  renderRconCommands,
  type RconClient,
} from './minecraft-rcon/minecraft-rcon';

const event: LiveEvent = {
  id: 'e',
  platform: 'simulator',
  timestamp: 0,
  type: 'gift',
  user: {
    id: '1',
    username: 'bob',
    displayName: "Bob l'ami",
    isModerator: false,
    isSubscriber: false,
    isFollower: false,
  },
  gift: { id: '5655', name: 'Rose', diamonds: 1 },
  count: 3,
  streakFinal: true,
};
const ctx = contextFromEvent(event);
const signal = () => new AbortController().signal;
const fx = (effectId: string, params: Record<string, unknown>, integrationId = 'x') =>
  EffectSchema.parse({ integrationId, effectId, params });

describe('input script', () => {
  it('parses every command', () => {
    expect(
      parseInputScript(`# demo
        tap ctrl+shift+s
        hold W 1500
        wait 200
        type gg wp
        click right double
        move 10 20
        moveby -5 5
        scroll 0 -3`),
    ).toEqual([
      { op: 'tap', key: 's', modifiers: ['control', 'shift'] },
      { op: 'hold', key: 'w', modifiers: [], ms: 1500 },
      { op: 'wait', ms: 200 },
      { op: 'type', text: 'gg wp' },
      { op: 'click', button: 'right', double: true },
      { op: 'move', x: 10, y: 20 },
      { op: 'moveby', x: -5, y: 5 },
      { op: 'scroll', x: 0, y: -3 },
    ]);
  });

  it('reports errors with line numbers', () => {
    expect(() => parseInputScript('tap space\nfly away')).toThrow(/Ligne 2/);
    expect(() => parseInputScript('tap notakey')).toThrow(/touche inconnue/);
    expect(() => parseInputScript('tap a+b')).toThrow(/modificateur/);
    expect(() => parseInputScript('wait 999999')).toThrow(/hors limites/);
  });
});

describe('InputIntegration', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function recorder() {
    const calls: string[] = [];
    const driver: InputDriver = {
      keyTap: (k, m) => calls.push(`tap ${[...m, k].join('+')}`),
      keyToggle: (k, d) => calls.push(`${d ? 'down' : 'up'} ${k}`),
      typeString: (t) => calls.push(`type ${t}`),
      moveMouse: (x, y) => calls.push(`move ${x},${y}`),
      moveMouseRelative: (x, y) => calls.push(`moveby ${x},${y}`),
      mouseClick: (b) => calls.push(`click ${b}`),
      mouseToggle: (b, d) => calls.push(`mouse${d ? 'down' : 'up'} ${b}`),
      scrollMouse: (x, y) => calls.push(`scroll ${x},${y}`),
    };
    return { calls, driver };
  }

  it('runs sequences one at a time', async () => {
    const { calls, driver } = recorder();
    const integ = new InputIntegration({ stepDelayMs: 0 }, driver);
    const a = integ.execute(fx('input.hold', { key: 'w', ms: 100 }), ctx, signal());
    const b = integ.execute(fx('input.tap', { key: 'space' }), ctx, signal());
    await vi.runAllTimersAsync();
    await Promise.all([a, b]);
    expect(calls).toEqual(['down w', 'up w', 'tap space']);
  });

  it('releases held keys and buttons when aborted', async () => {
    const { calls, driver } = recorder();
    const integ = new InputIntegration({ stepDelayMs: 0 }, driver);
    const ctrl = new AbortController();
    const p = integ.execute(
      fx('input.sequence', { script: 'down shift\nmousedown left\nwait 5000\ntap a' }),
      ctx,
      ctrl.signal,
    );
    const assertion = expect(p).rejects.toThrow('aborted');
    await vi.advanceTimersByTimeAsync(100);
    ctrl.abort();
    await assertion;
    expect(calls).toEqual(['down shift', 'mousedown left', 'up shift', 'mouseup left']);
  });

  it('fails clearly without a native driver', async () => {
    const integ = new InputIntegration({ stepDelayMs: 0 }, undefined);
    expect(integ.status().state).toBe('error');
    await expect(integ.execute(fx('input.tap', { key: 'a' }), ctx, signal())).rejects.toThrow();
  });
});

describe('Minecraft RCON', () => {
  it('renders multi-line commands with variables and escaping', () => {
    const cmds = renderRconCommands(
      '/title {player} title {"text":"{displayName}"}\n# comment\n\nsay {count}x {giftName}',
      ctx,
      'Enzo',
    );
    expect(cmds).toEqual(['title Enzo title {"text":"Bob l’ami"}', 'say 3x Rose']);
    expect(renderRconCommands('kill {player}', ctx, '')).toEqual(['kill @a']);
  });

  it('every preset renders to at least one command', () => {
    for (const p of RCON_PRESETS) {
      expect(renderRconCommands(String(p.params.command), ctx, 'Enzo').length).toBeGreaterThan(0);
    }
  });

  function fakeRcon(fail = false) {
    const sent: string[] = [];
    let connects = 0;
    const factory = async () => {
      connects++;
      if (fail) throw new Error('ECONNREFUSED');
      const client: RconClient = {
        send: async (c) => {
          sent.push(c);
          return '';
        },
        end: async () => undefined,
        on: () => undefined,
      };
      return client;
    };
    return { sent, factory, connects: () => connects };
  }

  it('connects lazily once and sends commands', async () => {
    const r = fakeRcon();
    const integ = new MinecraftRconIntegration(
      RconConfigSchema.parse({ password: 'x', player: 'Enzo' }),
      { log: () => {} },
      r.factory,
    );
    await integ.execute(fx('rcon.command', { command: 'say a\nsay b' }), ctx, signal());
    await integ.execute(fx('rcon.command', { command: 'say c' }), ctx, signal());
    expect(r.sent).toEqual(['say a', 'say b', 'say c']);
    expect(r.connects()).toBe(1);
    expect(integ.status().state).toBe('connected');
  });

  it('reports connection errors', async () => {
    const r = fakeRcon(true);
    const integ = new MinecraftRconIntegration(RconConfigSchema.parse({}), { log: () => {} }, r.factory);
    await expect(integ.execute(fx('rcon.command', { command: 'say a' }), ctx, signal())).rejects.toThrow(
      /RCON/,
    );
    expect(integ.status().state).toBe('error');
  });
});

describe('IntegrationManager', () => {
  it('validates config and routes effects', async () => {
    const m = new IntegrationManager({ log: () => {} });
    await expect(
      m.upsert({ id: 'mc', kind: 'minecraft-rcon', name: 'MC', enabled: true, config: { port: 99999 } }),
    ).rejects.toThrow();
    await expect(m.upsert({ id: 'z', kind: 'nope', name: 'Z', enabled: true, config: {} })).rejects.toThrow();
    await m.upsert({ id: 'in', kind: 'input', name: 'Input', enabled: false, config: {} });
    await expect(m.run(fx('input.tap', { key: 'a' }, 'in'), ctx, signal())).rejects.toThrow(/désactivée/);
  });
});
