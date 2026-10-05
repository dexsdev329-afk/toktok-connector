import { describe, expect, it } from 'vitest';
import { RoomHub, parsePins, type Client } from './hub';

function client(ip = '1.1.1.1') {
  const sent: Record<string, unknown>[] = [];
  const c: Client & { sent: typeof sent; closed: number | null } = {
    ip,
    sent,
    closed: null,
    send: (d) => sent.push(JSON.parse(d) as Record<string, unknown>),
    close: (code) => {
      c.closed = code;
    },
  };
  return c;
}

const setup = (now = () => 0) =>
  new RoomHub({ pins: parsePins('1:1234,2:abcd99'), now, maxMessagesPerSecond: 5 });
const join = (hub: RoomHub, c: Client, room: number, pin: string, role: string) => {
  hub.connect(c);
  hub.handle(c, JSON.stringify({ type: 'join', room, pin, role, name: role }));
};

describe('rooms hub', () => {
  it('parses pins', () => {
    expect([...parsePins('1:1234, 2:ab, 30:9999,x:1,3:pin-ok')]).toEqual([
      [1, '1234'],
      [3, 'pin-ok'],
    ]);
  });

  it('relays app events to the games of the same room only', () => {
    const hub = setup();
    const app = client();
    const game = client();
    const other = client();
    join(hub, app, 1, '1234', 'publisher');
    join(hub, game, 1, '1234', 'game');
    join(hub, other, 2, 'abcd99', 'game');
    expect(game.sent[0]).toMatchObject({ type: 'joined', room: 1, role: 'game' });
    hub.handle(app, JSON.stringify({ type: 'event', event: { type: 'gift', count: 3 } }));
    hub.handle(app, JSON.stringify({ type: 'effect', effect: 'bonus', params: { x: 1 } }));
    expect(game.sent.filter((m) => m.type === 'event' || m.type === 'effect')).toHaveLength(2);
    expect(other.sent.filter((m) => m.type === 'event')).toHaveLength(0);
    hub.handle(game, JSON.stringify({ type: 'game', data: { score: 42 } }));
    expect(app.sent.at(-1)).toEqual({ type: 'game', data: { score: 42 }, from: 'game' });
  });

  it('enforces roles', () => {
    const hub = setup();
    const game = client();
    join(hub, game, 1, '1234', 'game');
    hub.handle(game, JSON.stringify({ type: 'event', event: {} }));
    expect(game.sent.at(-1)).toMatchObject({ type: 'error' });
  });

  it('rejects bad pins and locks an address after repeated failures', () => {
    let t = 0;
    const hub = setup(() => t);
    for (let i = 0; i < 5; i++) {
      const c = client('9.9.9.9');
      join(hub, c, 1, '0000', 'game');
      expect(c.closed).toBe(4003);
    }
    const locked = client('9.9.9.9');
    join(hub, locked, 1, '1234', 'game');
    expect(locked.closed).toBe(4008);
    t += 5 * 60_000 + 1;
    const ok = client('9.9.9.9');
    join(hub, ok, 1, '1234', 'game');
    expect(ok.closed).toBeNull();
    expect(ok.sent[0]).toMatchObject({ type: 'joined' });
  });

  it('rate limits chatty clients', () => {
    const hub = setup(() => 0);
    const app = client();
    join(hub, app, 1, '1234', 'publisher');
    for (let i = 0; i < 8; i++) hub.handle(app, JSON.stringify({ type: 'event', event: {} }));
    expect(app.sent.filter((m) => m.type === 'error' && m.message === 'trop de messages')).toHaveLength(3);
  });
});
