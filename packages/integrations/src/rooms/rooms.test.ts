import { contextFromEvent, EffectSchema, type LiveEvent } from '@toktok/shared';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import { RoomHub, parsePins, type Client } from '../../../../apps/rooms-server/src/hub';
import { RoomsIntegration } from './rooms';

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
  count: 4,
  streakFinal: true,
};

let wss: WebSocketServer | null = null;
let integ: RoomsIntegration | null = null;
afterEach(async () => {
  await integ?.disconnect();
  await new Promise<void>((r) => (wss ? wss.close(() => r()) : r()));
  wss = null;
});

/** In-process rooms server (same hub as apps/rooms-server). */
async function startServer(): Promise<number> {
  const hub = new RoomHub({ pins: parsePins('3:secret-pin') });
  wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise((r) => wss!.once('listening', r));
  wss.on('connection', (ws) => {
    const c: Client = { ip: 'x', send: (d) => ws.send(d), close: (code, reason) => ws.close(code, reason) };
    hub.connect(c);
    ws.on('message', (d) => hub.handle(c, String(d)));
    ws.on('close', () => hub.disconnect(c));
  });
  return (wss.address() as { port: number }).port;
}

async function waitFor(cond: () => boolean, ms = 2000) {
  const t = Date.now();
  while (!cond()) {
    if (Date.now() - t > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('RoomsIntegration', () => {
  it('joins as publisher and relays events and effects to games', async () => {
    const port = await startServer();
    const game = new WebSocket(`ws://127.0.0.1:${port}`);
    const got: Record<string, unknown>[] = [];
    game.on('message', (d) => got.push(JSON.parse(String(d)) as Record<string, unknown>));
    await new Promise((r) => game.on('open', r));
    game.send(JSON.stringify({ type: 'join', room: 3, pin: 'secret-pin', role: 'game' }));

    integ = new RoomsIntegration(
      { url: `ws://127.0.0.1:${port}`, room: 3, pin: 'secret-pin', forwardEvents: true },
      { log: () => {} },
    );
    await integ.connect();
    await waitFor(() => integ!.status().state === 'connected');
    integ.onLiveEvent(event);
    await integ.execute(
      EffectSchema.parse({
        integrationId: 'r',
        effectId: 'rooms.effect',
        params: { effect: 'bonus', params: '{"n": {count}}' },
      }),
      contextFromEvent(event),
    );
    await waitFor(() => got.some((m) => m.type === 'effect'));
    expect(got.find((m) => m.type === 'event')).toMatchObject({ event: { type: 'gift', count: 4 } });
    expect(got.find((m) => m.type === 'effect')).toMatchObject({ effect: 'bonus', params: { n: 4 } });
    game.close();
  });

  it('changes the room PIN and reconnects with it', async () => {
    const port = await startServer();
    integ = new RoomsIntegration(
      { url: `ws://127.0.0.1:${port}`, room: 3, pin: 'secret-pin', forwardEvents: true },
      { log: () => {} },
    );
    await integ.connect();
    await waitFor(() => integ!.status().state === 'connected');
    await expect(integ.changePin('x')).rejects.toThrow(/PIN invalide/);
    await integ.changePin('new-pin-42');
    const game = new WebSocket(`ws://127.0.0.1:${port}`);
    const got: Record<string, unknown>[] = [];
    game.on('message', (d) => got.push(JSON.parse(String(d)) as Record<string, unknown>));
    await new Promise((r) => game.on('open', r));
    game.send(JSON.stringify({ type: 'join', room: 3, pin: 'new-pin-42', role: 'game' }));
    await waitFor(() => got.some((m) => m.type === 'joined'));
    game.close();
  });

  it('stops retrying on a wrong PIN', async () => {
    const port = await startServer();
    integ = new RoomsIntegration(
      { url: `ws://127.0.0.1:${port}`, room: 3, pin: 'wrong-pin', forwardEvents: true },
      { log: () => {} },
    );
    await integ.connect();
    await waitFor(() => integ!.status().state === 'error');
    expect(integ.status().detail).toMatch(/PIN/);
  });
});
