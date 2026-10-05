import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { ChaosModIntegration, parseChaosEffects } from './chaos-mod';

/** Minimal stand-in for the mod's debug socket (same message format). */
function fakeChaosMod() {
  const received: unknown[] = [];
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  wss.on('connection', (ws: WebSocket) => {
    ws.on('message', (d) => {
      const msg = JSON.parse(String(d)) as { command: string };
      received.push(msg);
      if (msg.command === 'fetch_effects') {
        ws.send(
          JSON.stringify({
            command: 'result_fetch_effects',
            effects: [
              { id: 'player_suicide', name: 'Suicide' },
              { id: 'world_lowgrav', name: 'Low Gravity' },
            ],
          }),
        );
      }
    });
  });
  const port = () => (wss.address() as { port: number }).port;
  return { wss, received, port };
}

const until = async (cond: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
};

let cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanup) await c();
  cleanup = [];
});

describe('Chaos Mod integration', () => {
  it('fetches the effect list, then triggers chosen and random effects', async () => {
    const mod = fakeChaosMod();
    await new Promise((r) => mod.wss.once('listening', r));
    const chaos = new ChaosModIntegration(
      { port: mod.port() },
      { log: () => undefined },
      undefined,
      () => 0.99,
    );
    cleanup.push(
      () => chaos.disconnect(),
      () => new Promise((r) => mod.wss.close(() => r())),
    );
    await chaos.connect();
    await until(() => chaos.status().detail === '2 effets Chaos disponibles');
    const trigger = chaos.listEffects()[0]!;
    expect(trigger.params[0]).toMatchObject({
      type: 'select',
      options: [{ value: 'world_lowgrav' }, { value: 'player_suicide' }],
    });

    await chaos.execute({
      integrationId: 'c',
      effectId: 'chaos.trigger',
      params: { effect: 'world_lowgrav' },
      delayMs: 0,
      repeat: 1,
      repeatIntervalMs: 0,
    });
    await chaos.execute({
      integrationId: 'c',
      effectId: 'chaos.random',
      params: {},
      delayMs: 0,
      repeat: 1,
      repeatIntervalMs: 0,
    });
    await expect(
      chaos.execute({
        integrationId: 'c',
        effectId: 'chaos.trigger',
        params: { effect: 'nope' },
        delayMs: 0,
        repeat: 1,
        repeatIntervalMs: 0,
      }),
    ).rejects.toThrow('inconnu');
    await until(() => mod.received.length >= 3);
    expect(mod.received).toEqual([
      { command: 'fetch_effects' },
      { command: 'trigger_effect', effect_id: 'world_lowgrav' },
      { command: 'trigger_effect', effect_id: 'player_suicide' },
    ]);
  });

  it('waits for the game when the socket is closed', async () => {
    const chaos = new ChaosModIntegration({ port: 1 }, { log: () => undefined });
    cleanup.push(() => chaos.disconnect());
    await chaos.connect();
    await until(() => chaos.status().state === 'connecting');
    await expect(
      chaos.execute({
        integrationId: 'c',
        effectId: 'chaos.random',
        params: {},
        delayMs: 0,
        repeat: 1,
        repeatIntervalMs: 0,
      }),
    ).rejects.toThrow('non connecté');
  });

  it('parses only well-formed effect lists', () => {
    expect(parseChaosEffects({ command: 'other' })).toBeNull();
    expect(
      parseChaosEffects({ command: 'result_fetch_effects', effects: [{ id: 'a' }, { name: 'x' }, 3] }),
    ).toEqual([{ id: 'a', name: 'a' }]);
  });
});
