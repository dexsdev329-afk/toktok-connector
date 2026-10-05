import type { LiveEvent } from '@toktok/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Backoff } from '../types';
import { HttpError, KickConnector, type KickSocketLike } from './kick-connector';
import {
  cleanKickText,
  KICK_EVENTS,
  mapKickGiftList,
  mapKickMessage,
  normalizeKickChannel,
  parseKickChannel,
} from './mapper';

// Payloads trimmed from real Kick Pusher messages (October 2026).
const CHAT = {
  id: 'm1',
  chatroom_id: 668,
  content: '!tnt [emote:37226:KEKW]',
  type: 'message',
  sender: {
    id: 102405303,
    username: 'OMAR1OMAR12',
    slug: 'omar1omar12',
    identity: { color: '#4CFF75', badges: [{ type: 'subscriber', text: 'Subscriber', count: 2 }] },
  },
};
const KICKS = {
  gift_transaction_id: 'x',
  sender: { id: 108252316, username: 'dhiraj_1818', profile_picture: 'https://files.kick.com/p.webp' },
  gift: { gift_id: 'hell_yeah', name: 'Hell Yeah', amount: 1, type: 'BASIC' },
};
const CHANNEL = {
  id: 668,
  slug: 'xqc',
  chatroom: { id: 668 },
  livestream: { id: 1, is_live: true, viewer_count: 4200 },
};

describe('Kick mapper', () => {
  it('maps chat messages, badges and emotes', () => {
    const [e] = mapKickMessage(KICK_EVENTS.chat, CHAT);
    expect(e).toMatchObject({
      type: 'chat',
      platform: 'kick',
      text: '!tnt KEKW',
      user: { username: 'omar1omar12', displayName: 'OMAR1OMAR12', isSubscriber: true, isModerator: false },
    });
  });

  it('maps Kicks gifts with a prefixed id and their value', () => {
    const [e] = mapKickMessage(KICK_EVENTS.kicks, KICKS);
    expect(e).toMatchObject({
      type: 'gift',
      count: 1,
      streakFinal: true,
      gift: { id: 'kick:hell_yeah', name: 'Hell Yeah', diamonds: 1 },
      user: { displayName: 'dhiraj_1818', avatarUrl: 'https://files.kick.com/p.webp' },
    });
  });

  it('maps subscriptions and gifted subscriptions', () => {
    expect(
      mapKickMessage(KICK_EVENTS.subscription, { user_ids: [1], username: 'ArdaYagiz', channel_id: 2 })[0],
    ).toMatchObject({ type: 'subscribe', user: { username: 'ardayagiz', isSubscriber: true } });
    expect(
      mapKickMessage(KICK_EVENTS.giftedSubs, {
        gifted_usernames: ['a', 'b', 'c'],
        gifter_username: 'Bob',
      })[0],
    ).toMatchObject({
      type: 'gift',
      count: 3,
      gift: { id: 'kick:gifted-sub' },
      user: { displayName: 'Bob' },
    });
  });

  it('only maps follows that name the follower', () => {
    expect(mapKickMessage(KICK_EVENTS.followers, { followersCount: 10, followed: true })).toEqual([]);
    expect(mapKickMessage(KICK_EVENTS.followers, { username: 'Zed', followed: true })[0]?.type).toBe(
      'follow',
    );
  });

  it('ignores unknown or malformed payloads', () => {
    expect(mapKickMessage('App\\Events\\UserBannedEvent', { user: {} })).toEqual([]);
    expect(mapKickMessage(KICK_EVENTS.chat, null)).toEqual([]);
    expect(mapKickMessage(KICK_EVENTS.kicks, { gift: {} })).toEqual([]);
  });

  it('parses channels, gift lists and channel names', () => {
    expect(parseKickChannel(CHANNEL)).toEqual({
      channelId: 668,
      chatroomId: 668,
      slug: 'xqc',
      live: true,
      viewers: 4200,
    });
    expect(parseKickChannel({ ...CHANNEL, livestream: null })?.live).toBe(false);
    expect(parseKickChannel({})).toBeNull();
    expect(
      mapKickGiftList({ data: [KICKS.gift, { gift_id: 'stomp', name: 'Stomp', amount: 5000 }] }),
    ).toEqual([
      { id: 'kick:hell_yeah', name: 'Hell Yeah', diamonds: 1 },
      { id: 'kick:stomp', name: 'Stomp', diamonds: 5000 },
    ]);
    expect(normalizeKickChannel('https://kick.com/XQC?x=1')).toBe('xqc');
    expect(cleanKickText('[emote:1:a] [emote:2:b]')).toBe('a b');
  });
});

class FakeSocket implements KickSocketLike {
  sent: { event: string; data: { channel?: string } }[] = [];
  closed = false;
  private readonly handlers = new Map<string, ((...a: unknown[]) => void)[]>();
  on(event: string, listener: (...a: never[]) => void): this {
    const list = this.handlers.get(event) ?? [];
    list.push(listener as (...a: unknown[]) => void);
    this.handlers.set(event, list);
    return this;
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data) as FakeSocket['sent'][number]);
  }
  close(): void {
    this.closed = true;
  }
  removeAllListeners(): this {
    this.handlers.clear();
    return this;
  }
  fire(event: string, ...args: unknown[]): void {
    for (const h of this.handlers.get(event) ?? []) h(...args);
  }
  receive(event: string, data: unknown, channel?: string): void {
    this.fire(
      'message',
      JSON.stringify({ event, data: JSON.stringify(data), ...(channel ? { channel } : {}) }),
    );
  }
}

describe('KickConnector', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(channel: unknown = CHANNEL) {
    const sockets: FakeSocket[] = [];
    let current: unknown = channel;
    const fetchJson = vi.fn(async (url: string) => {
      if (current instanceof Error) throw current;
      expect(url).toContain('/channels/');
      return current;
    });
    const c = new KickConnector({
      fetchJson,
      createSocket: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
      backoff: new Backoff(1000, 1000, () => 0),
    });
    const events: LiveEvent[] = [];
    c.on('event', (e) => events.push(e));
    return { c, sockets, events, fetchJson, setChannel: (v: unknown) => (current = v) };
  }

  async function establish(s: FakeSocket) {
    s.receive('pusher:connection_established', { socket_id: '1', activity_timeout: 120 });
    s.receive('pusher_internal:subscription_succeeded', {}, 'chatrooms.668.v2');
    await vi.advanceTimersByTimeAsync(0);
  }

  it('subscribes to the channel feeds and emits live events', async () => {
    const { c, sockets, events } = setup();
    await c.connect('https://kick.com/xQc');
    const s = sockets[0]!;
    await establish(s);
    expect(s.sent.map((m) => m.data.channel)).toEqual(['chatrooms.668.v2', 'channel_668', 'channel.668']);
    expect(c.getStatus().status).toBe('connected');
    s.receive(KICK_EVENTS.chat, CHAT, 'chatrooms.668.v2');
    s.receive(KICK_EVENTS.kicks, KICKS, 'channel_668');
    expect(events.map((e) => e.type)).toEqual(['connected', 'viewerCount', 'chat', 'gift']);
  });

  it('deduplicates the two subscription events of one sub', async () => {
    const { c, sockets, events } = setup();
    await c.connect('xqc');
    await establish(sockets[0]!);
    sockets[0]!.receive(KICK_EVENTS.subscription, { username: 'Ann' });
    sockets[0]!.receive(KICK_EVENTS.subscriptionLegacy, { username: 'Ann', months: 1 });
    expect(events.filter((e) => e.type === 'subscribe')).toHaveLength(1);
  });

  it('waits for the live, then connects', async () => {
    const { c, sockets, setChannel } = setup({ ...CHANNEL, livestream: null });
    await c.connect('xqc');
    expect(c.getStatus().status).toBe('waiting-live');
    expect(sockets).toHaveLength(0);
    setChannel(CHANNEL);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(sockets).toHaveLength(1);
  });

  it('stops on unknown channels', async () => {
    const { c } = setup(new HttpError(404));
    await c.connect('nobody');
    expect(c.getStatus()).toMatchObject({ status: 'error', detail: 'Chaîne Kick introuvable' });
  });

  it('detects the end of the live through polling', async () => {
    const { c, sockets, events, setChannel } = setup();
    await c.connect('xqc');
    await establish(sockets[0]!);
    setChannel({ ...CHANNEL, livestream: null });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(events.at(-1)).toMatchObject({ type: 'disconnected', liveEnded: true });
    expect(c.getStatus().status).toBe('waiting-live');
    expect(sockets[0]!.closed).toBe(true);
  });

  it('reconnects when the socket closes', async () => {
    const { c, sockets } = setup();
    await c.connect('xqc');
    await establish(sockets[0]!);
    sockets[0]!.fire('close');
    expect(c.getStatus().status).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(1000);
    expect(sockets).toHaveLength(2);
  });

  it('answers pings and ignores events after disconnect', async () => {
    const { c, sockets, events } = setup();
    await c.connect('xqc');
    const s = sockets[0]!;
    await establish(s);
    s.receive('pusher:ping', {});
    expect(s.sent.at(-1)?.event).toBe('pusher:pong');
    await c.disconnect();
    const n = events.length;
    s.receive(KICK_EVENTS.chat, CHAT);
    expect(events.length).toBe(n);
    expect(c.getStatus().status).toBe('idle');
  });

  it('rejects invalid channel names', async () => {
    const { c } = setup();
    await expect(c.connect('a b')).rejects.toThrow('invalide');
  });
});
