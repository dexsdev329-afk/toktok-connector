import { contextFromEvent, EffectSchema, type LiveEvent } from '@toktok/shared';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { ModBridgeConfigSchema, ModBridgeIntegration, modEffectId } from './mod-bridge';

const event: LiveEvent = {
  id: 'e',
  platform: 'simulator',
  timestamp: 0,
  type: 'gift',
  user: {
    id: '1',
    username: 'bob',
    displayName: 'Bob',
    isModerator: false,
    isSubscriber: false,
    isFollower: false,
  },
  gift: { id: '5655', name: 'Rose', diamonds: 1 },
  count: 3,
  streakFinal: true,
};
const ctx = contextFromEvent(event);
const fx = (effectId: string, params: Record<string, unknown>) =>
  EffectSchema.parse({ integrationId: 'm', effectId, params });
const signal = () => new AbortController().signal;

let bridge: ModBridgeIntegration | null = null;
afterEach(async () => {
  await bridge?.disconnect();
  bridge = null;
});

async function start(token = 'secret-token') {
  bridge = new ModBridgeIntegration(
    { ...ModBridgeConfigSchema.parse({ token }), port: 0, resultTimeoutMs: 500 },
    { log: () => {} },
  );
  await bridge.connect();
  return bridge;
}

/** Fake mod: answers effects with the given status and records messages. */
function fakeMod(
  port: number,
  opts: { token?: string; status?: 'ok' | 'busy' | 'error' | 'none'; origin?: string } = {},
) {
  const got: Record<string, unknown>[] = [];
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, opts.origin ? { origin: opts.origin } : {});
  const welcomed = new Promise<boolean>((resolve) => {
    ws.on('open', () =>
      ws.send(
        JSON.stringify({
          type: 'hello',
          protocol: 1,
          token: opts.token ?? 'secret-token',
          mod: { id: 'demo-mod', name: 'Demo' },
          effects: [
            {
              id: 'spawn_cube',
              name: 'Spawn cube',
              params: { count: { type: 'int', default: 1, min: 1, max: 10 } },
            },
          ],
        }),
      ),
    );
    ws.on('message', (data) => {
      const msg = JSON.parse(String(data)) as Record<string, unknown>;
      got.push(msg);
      if (msg.type === 'welcome') resolve(true);
      if (msg.type === 'effect' && opts.status !== 'none') {
        ws.send(JSON.stringify({ type: 'result', id: msg.id, status: opts.status ?? 'ok', message: 'nope' }));
      }
    });
    ws.on('close', () => resolve(false));
    ws.on('error', () => resolve(false));
  });
  return { ws, got, welcomed };
}

describe('ModBridgeIntegration', () => {
  it('authenticates mods, exposes their effects and runs them', async () => {
    const b = await start();
    const mod = fakeMod(b.port);
    expect(await mod.welcomed).toBe(true);
    expect(b.status().state).toBe('connected');
    const ids = b.listEffects().map((e) => e.id);
    expect(ids).toContain(modEffectId('demo-mod', 'spawn_cube'));

    await b.execute(
      fx(modEffectId('demo-mod', 'spawn_cube'), { count: 2, label: 'by {username}' }),
      ctx,
      signal(),
    );
    await b.execute(
      fx('bridge.send', { mod: 'demo-mod', effect: 'raw', params: '{"n": {count}, "u": "{username}"}' }),
      ctx,
      signal(),
    );
    const effects = mod.got.filter((m) => m.type === 'effect');
    expect(effects.map((e) => [e.effect, e.params])).toEqual([
      ['spawn_cube', { count: 2, label: 'by bob' }],
      ['raw', { n: 3, u: 'bob' }],
    ]);
    expect((effects[0]!.context as Record<string, unknown>).giftName).toBe('Rose');
    mod.ws.close();
  });

  it('rejects bad tokens and browser origins', async () => {
    const b = await start();
    expect(await fakeMod(b.port, { token: 'wrong-token' }).welcomed).toBe(false);
    expect(await fakeMod(b.port, { origin: 'https://evil.example' }).welcomed).toBe(false);
    expect(b.status().state).toBe('connecting');
  });

  it('reports busy, errors, timeouts and missing mods', async () => {
    const b = await start();
    await expect(b.execute(fx(modEffectId('demo-mod', 'spawn_cube'), {}), ctx, signal())).rejects.toThrow(
      /non connecté/,
    );
    const busy = fakeMod(b.port, { status: 'busy' });
    await busy.welcomed;
    await expect(b.execute(fx(modEffectId('demo-mod', 'spawn_cube'), {}), ctx, signal())).rejects.toThrow(
      /occupé/,
    );
    busy.ws.close();
    await new Promise((r) => setTimeout(r, 50));
    const silent = fakeMod(b.port, { status: 'none' });
    await silent.welcomed;
    await expect(b.execute(fx(modEffectId('demo-mod', 'spawn_cube'), {}), ctx, signal())).rejects.toThrow(
      /Pas de réponse/,
    );
    silent.ws.close();
  });

  it('forwards subscribed live events only', async () => {
    const b = await start();
    const mod = fakeMod(b.port);
    await mod.welcomed;
    mod.ws.send(JSON.stringify({ type: 'subscribe', events: ['gift'] }));
    await new Promise((r) => setTimeout(r, 50));
    b.onLiveEvent(event);
    b.onLiveEvent({ ...event, type: 'follow' } as LiveEvent);
    await new Promise((r) => setTimeout(r, 50));
    expect(mod.got.filter((m) => m.type === 'event')).toHaveLength(1);
    mod.ws.close();
  });
});
