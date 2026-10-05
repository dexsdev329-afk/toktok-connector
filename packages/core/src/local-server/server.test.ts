import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { LiveEvent, OverlayConfig, OverlayServerMessage } from '@toktok/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { openDatabase } from '../db/database';
import { SessionsRepo } from '../db/repositories';
import { SessionTracker } from '../stats/session-tracker';
import { effectiveLikeGoal, OverlayFeeder } from './overlay-feeder';
import { LocalServer } from './server';

const dir = mkdtempSync(path.join(tmpdir(), 'ovl-'));
mkdirSync(path.join(dir, 'assets'));
writeFileSync(path.join(dir, 'index.html'), '<html>overlay</html>');
writeFileSync(path.join(dir, 'assets', 'app.js'), 'console.log(1)');
writeFileSync(path.join(dir, 'secret.txt'), 'nope');

const triggered: string[] = [];
const gameDir = mkdtempSync(path.join(tmpdir(), 'game-'));
writeFileSync(path.join(gameDir, 'index.html'), '<html>my game</html>');
const gameMessages: unknown[] = [];
const server = new LocalServer({
  port: 0,
  overlaysDir: dir,
  getOverlay: (id) => (id === 'ov1' ? { id, token: 'tok-123' } : null),
  initialMessages: () => [{ type: 'likes', total: 1, goal: 10 }],
  apiToken: () => 'api-secret',
  getGame: (id) => (id === 'g1' ? { id, token: 'game-tok', folder: gameDir } : null),
  onGameMessage: (_id, data) => gameMessages.push(data),
  gameClientScript: 'window.TokTokGame={}',
  triggerAction: (id) => {
    triggered.push(id);
    return id === 'a1';
  },
});

function http(
  method: string,
  p: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string; headers: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: server.port, method, path: p, headers }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

function ws(p: string, origin?: string): Promise<{ ok: boolean; first?: unknown }> {
  return new Promise((resolve) => {
    const sock = new WebSocket(`ws://127.0.0.1:${server.port}${p}`, origin ? { origin } : {});
    sock.on('message', (d) => {
      resolve({ ok: true, first: JSON.parse(String(d)) });
      sock.close();
    });
    sock.on('error', () => resolve({ ok: false }));
  });
}

beforeAll(async () => {
  await server.start();
});
afterAll(async () => {
  await server.stop();
});

describe('LocalServer', () => {
  it('listens on loopback only', () => {
    expect(server.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it('serves an overlay only with a valid token', async () => {
    expect((await http('GET', '/o/ov1?t=tok-123')).body).toContain('overlay');
    expect((await http('GET', '/o/ov1?t=wrong')).status).toBe(403);
    expect((await http('GET', '/o/unknown?t=tok-123')).status).toBe(403);
  });

  it('serves assets without path traversal', async () => {
    expect((await http('GET', '/assets/app.js')).status).toBe(200);
    expect((await http('GET', '/assets/..%2Fsecret.txt')).status).toBe(404);
    expect((await http('GET', '/assets/../secret.txt')).status).toBe(404);
  });

  it('rejects foreign Host headers (DNS rebinding)', async () => {
    expect((await http('GET', '/health', { Host: 'evil.example:80' })).status).toBe(421);
  });

  it('protects the API with a bearer token', async () => {
    expect((await http('POST', '/api/actions/a1/trigger')).status).toBe(401);
    expect(
      (await http('POST', '/api/actions/a1/trigger', { Authorization: 'Bearer api-secret' })).status,
    ).toBe(202);
    expect(
      (await http('POST', '/api/actions/zz/trigger', { Authorization: 'Bearer api-secret' })).status,
    ).toBe(404);
    expect(triggered).toEqual(['a1', 'zz']);
  });

  it('accepts overlay websockets from our origin and rejects others', async () => {
    const good = await ws('/ws/overlay?id=ov1&t=tok-123');
    expect(good).toEqual({ ok: true, first: { type: 'likes', total: 1, goal: 10 } });
    expect((await ws('/ws/overlay?id=ov1&t=tok-123', server.origin)).ok).toBe(true);
    expect((await ws('/ws/overlay?id=ov1&t=tok-123', 'https://evil.example')).ok).toBe(false);
    expect((await ws('/ws/overlay?id=ov1&t=bad')).ok).toBe(false);
  });
});

describe('home games', () => {
  it('serves local game folders and the client script, without traversal', async () => {
    expect((await http('GET', '/games/g1/')).body).toContain('my game');
    expect((await http('GET', '/games/g1/..%2F..%2Fetc%2Fpasswd')).status).toBe(404);
    expect((await http('GET', '/games/nope/')).status).toBe(404);
    expect((await http('GET', '/toktok-game-client.js')).body).toContain('TokTokGame');
  });

  it('accepts game sockets from any origin with a valid token and relays both ways', async () => {
    const url = `ws://127.0.0.1:${server.port}/ws/game?id=g1&t=game-tok`;
    const sock = new WebSocket(url, { origin: 'https://my-game.up.railway.app' });
    const got: unknown[] = [];
    sock.on('message', (d) => got.push(JSON.parse(String(d))));
    await new Promise((r) => sock.on('open', r));
    server.sendToGame('*', { type: 'event', event: { type: 'like' } });
    sock.send(JSON.stringify({ type: 'game', data: { score: 7 } }));
    await new Promise((r) => setTimeout(r, 100));
    expect(got).toEqual([
      { type: 'welcome', game: 'g1' },
      { type: 'event', event: { type: 'like' } },
    ]);
    expect(gameMessages).toEqual([{ score: 7 }]);
    expect(server.gameConnectedCount('g1')).toBe(1);
    sock.close();
    expect((await ws('/ws/game?id=g1&t=wrong')).ok).toBe(false);
  });
});

describe('OverlayFeeder', () => {
  const user = {
    id: 'u',
    username: 'u',
    displayName: 'U',
    isModerator: false,
    isSubscriber: false,
    isFollower: false,
  };
  const overlays: OverlayConfig[] = [
    {
      id: 'al',
      kind: 'alerts',
      name: 'A',
      style: {
        theme: 'default',
        primaryColor: '#ff0000',
        textColor: '#ffffff',
        fontFamily: 'x',
        fontSizePx: 20,
        animation: 'pop',
      },
      options: { minDiamonds: 5 },
    },
  ];

  function setup() {
    const sent: [string, OverlayServerMessage][] = [];
    const tracker = new SessionTracker(new SessionsRepo(openDatabase(':memory:')));
    const feeder = new OverlayFeeder(
      () => overlays,
      tracker,
      (id, m) => sent.push([id, m]),
      0,
    );
    return { sent, feeder };
  }

  it('shows one alert per streak with its total, above the threshold', () => {
    const { sent, feeder } = setup();
    const g = (count: number, final: boolean): Extract<LiveEvent, { type: 'gift' }> => ({
      id: Math.random().toString(),
      platform: 'simulator',
      timestamp: 0,
      type: 'gift',
      user,
      gift: { id: 'r', name: 'Rose', diamonds: 1 },
      count,
      streakId: 's1',
      streakFinal: final,
    });
    feeder.handle(g(2, false));
    feeder.handle(g(3, false));
    feeder.handle(g(1, true)); // repeat mode: total 6
    feeder.handle({ ...g(1, true), streakId: 's2' }); // below threshold
    const alerts = sent
      .filter(([, m]) => m.type === 'alert')
      .map(([, m]) => (m.type === 'alert' ? m.alert.count : 0));
    expect(alerts).toEqual([6]);
    feeder.dispose();
  });

  it('computes the like goal with auto increment', () => {
    expect(effectiveLikeGoal(500, 1000, 0)).toBe(1000);
    expect(effectiveLikeGoal(1000, 1000, 0)).toBe(1000);
    expect(effectiveLikeGoal(1000, 1000, 500)).toBe(1500);
    expect(effectiveLikeGoal(1700, 1000, 500)).toBe(2000);
  });
});
