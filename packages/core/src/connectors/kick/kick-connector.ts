import { WebSocket } from 'ws';
import { makeId, type GiftInfo, type LiveEvent } from '@toktok/shared';
import { Backoff, BaseConnector } from '../types';
import {
  KICK_EVENTS,
  mapKickGiftList,
  mapKickMessage,
  normalizeKickChannel,
  parseKickChannel,
  type KickChannelInfo,
} from './mapper';

/**
 * Public Pusher application used by kick.com's web client (read-only, no authentication).
 * Observed in October 2026; overridable in case Kick rotates it.
 */
export const KICK_PUSHER_URL =
  'wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.4.0&flash=false';
export const KICK_API = 'https://kick.com/api/v2/channels/';
export const KICK_GIFTS_URL = 'https://web.kick.com/api/v1/kicks/gifts';

/** Minimal WebSocket surface we use (satisfied by the `ws` package). */
export interface KickSocketLike {
  on(event: 'open', listener: () => void): unknown;
  on(event: 'message', listener: (data: unknown) => void): unknown;
  on(event: 'close', listener: () => void): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
  send(data: string): void;
  close(): void;
  removeAllListeners(): unknown;
}

export class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

export interface KickConnectorOptions {
  /** GET a JSON document; must throw HttpError on non-2xx responses. */
  fetchJson: (url: string) => Promise<unknown>;
  createSocket: (url: string) => KickSocketLike;
  pusherUrl?: string;
  /** Live / viewers poll interval (ms). */
  pollMs?: number;
  /** Poll interval while the channel is offline (ms). */
  offlinePollMs?: number;
  /** Close and reconnect when nothing is received for this long (ms). */
  idleTimeoutMs?: number;
  onGiftSeen?: (gift: GiftInfo) => void;
  backoff?: Backoff;
}

const SUB_DEDUPE_MS = 15_000;

/**
 * Kick connector: reads the public Pusher feed of a channel (chat, subscriptions, gifted subs,
 * Kicks gifts) and polls the public channel API for the live state and viewer count.
 * Read-only: it never posts in the chat and needs no Kick account.
 */
export class KickConnector extends BaseConnector {
  readonly platform = 'kick' as const;
  private channel: string | null = null;
  private info: KickChannelInfo | null = null;
  private socket: KickSocketLike | null = null;
  private wanted = false;
  private generation = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private lastMessageAt = 0;
  private readonly recentSubs = new Map<string, number>();
  private readonly backoff: Backoff;

  constructor(private readonly opts: KickConnectorOptions) {
    super();
    this.backoff = opts.backoff ?? new Backoff();
  }

  async connect(channel: string): Promise<void> {
    const slug = normalizeKickChannel(channel);
    if (!/^[a-z0-9_-]{2,40}$/.test(slug)) throw new Error('Nom de chaîne Kick invalide');
    await this.disconnect();
    this.channel = slug;
    this.wanted = true;
    this.backoff.reset();
    await this.attempt();
  }

  async disconnect(): Promise<void> {
    const wasConnected = this.statusInfo.status === 'connected';
    this.wanted = false;
    this.generation++;
    this.clearTimers();
    this.closeSocket();
    if (wasConnected) this.emitDisconnected('manual', false);
    this.setStatus({ status: 'idle', channel: this.channel });
  }

  async fetchGifts(): Promise<GiftInfo[]> {
    return mapKickGiftList(await this.opts.fetchJson(KICK_GIFTS_URL));
  }

  private async attempt(): Promise<void> {
    if (!this.wanted || !this.channel) return;
    const gen = ++this.generation;
    const channel = this.channel;
    this.setStatus({ status: this.backoff.attempts > 0 ? 'reconnecting' : 'connecting', channel });
    let info: KickChannelInfo | null;
    try {
      info = parseKickChannel(await this.opts.fetchJson(KICK_API + encodeURIComponent(channel)));
    } catch (err) {
      if (gen !== this.generation) return;
      if (err instanceof HttpError && err.status === 404) {
        this.wanted = false;
        this.setStatus({ status: 'error', channel, detail: 'Chaîne Kick introuvable' });
        return;
      }
      const detail =
        err instanceof HttpError && err.status === 403 ? 'Accès refusé par Kick (403)' : String(err);
      this.scheduleRetry(this.backoff.next(), 'reconnecting', detail);
      return;
    }
    if (gen !== this.generation) return;
    if (!info) {
      this.scheduleRetry(this.backoff.next(), 'reconnecting', 'Réponse Kick inattendue');
      return;
    }
    this.info = info;
    if (!info.live) {
      this.scheduleRetry(this.opts.offlinePollMs ?? 30_000, 'waiting-live', 'Le live n’a pas commencé');
      return;
    }
    this.openSocket(info, gen);
  }

  private openSocket(info: KickChannelInfo, gen: number): void {
    const socket = this.opts.createSocket(this.opts.pusherUrl ?? KICK_PUSHER_URL);
    this.socket = socket;
    const channels = [
      `chatrooms.${info.chatroomId}.v2`,
      `channel_${info.channelId}`,
      `channel.${info.channelId}`,
    ];
    this.lastMessageAt = Date.now();

    socket.on('message', (raw) => {
      if (gen !== this.generation) return;
      this.lastMessageAt = Date.now();
      let msg: { event?: unknown; data?: unknown; channel?: unknown };
      try {
        msg = JSON.parse(String(raw)) as typeof msg;
      } catch {
        return;
      }
      const event = typeof msg.event === 'string' ? msg.event : '';
      if (event === 'pusher:connection_established') {
        for (const c of channels)
          socket.send(JSON.stringify({ event: 'pusher:subscribe', data: { auth: '', channel: c } }));
        return;
      }
      if (event === 'pusher:ping') return socket.send(JSON.stringify({ event: 'pusher:pong', data: {} }));
      if (event === 'pusher_internal:subscription_succeeded') {
        if (msg.channel === channels[0] && this.statusInfo.status !== 'connected')
          this.onConnected(info, gen);
        return;
      }
      if (event === 'pusher:error') {
        this.setStatus({ ...this.statusInfo, detail: `Pusher : ${JSON.stringify(msg.data).slice(0, 120)}` });
        return;
      }
      if (event === KICK_EVENTS.streamEnd) return this.onLiveEnded(gen);
      let data: unknown = msg.data;
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch {
          return;
        }
      }
      for (const e of mapKickMessage(event, data)) this.push(e);
    });
    socket.on('close', () => {
      if (gen !== this.generation) return;
      this.onLost(gen);
    });
    socket.on('error', (err) => {
      if (gen !== this.generation) return;
      this.setStatus({ ...this.statusInfo, detail: err.message });
    });
  }

  private onConnected(info: KickChannelInfo, gen: number): void {
    this.backoff.reset();
    const channel = this.channel ?? info.slug;
    this.setStatus({ status: 'connected', channel });
    this.emit('event', {
      id: makeId('con'),
      platform: 'kick',
      timestamp: Date.now(),
      type: 'connected',
      channel,
    });
    this.emitViewers(info.viewers);
    const idle = this.opts.idleTimeoutMs ?? 150_000;
    this.pingTimer = setInterval(
      () => {
        if (gen !== this.generation) return;
        if (Date.now() - this.lastMessageAt > idle) return this.onLost(gen);
        try {
          this.socket?.send(JSON.stringify({ event: 'pusher:ping', data: {} }));
        } catch {
          // close event will follow
        }
      },
      Math.min(60_000, idle / 2),
    );
    this.pollTimer = setInterval(() => void this.poll(gen), this.opts.pollMs ?? 30_000);
  }

  private async poll(gen: number): Promise<void> {
    if (!this.channel) return;
    try {
      const info = parseKickChannel(await this.opts.fetchJson(KICK_API + encodeURIComponent(this.channel)));
      if (gen !== this.generation || !info) return;
      if (!info.live) return this.onLiveEnded(gen);
      this.emitViewers(info.viewers);
    } catch {
      // transient API failure: keep the chat connection
    }
  }

  private push(e: LiveEvent): void {
    if (e.type === 'subscribe') {
      // ChannelSubscriptionEvent and the legacy SubscriptionEvent can both fire for one sub.
      const now = Date.now();
      for (const [k, t] of this.recentSubs) if (now - t > SUB_DEDUPE_MS) this.recentSubs.delete(k);
      if (this.recentSubs.has(e.user.username)) return;
      this.recentSubs.set(e.user.username, now);
    }
    if (e.type === 'gift' && e.gift.diamonds > 0) this.opts.onGiftSeen?.(e.gift);
    this.emit('event', e);
  }

  private emitViewers(count: number): void {
    this.emit('event', {
      id: makeId('kvw'),
      platform: 'kick',
      timestamp: Date.now(),
      type: 'viewerCount',
      count,
    });
  }

  private onLiveEnded(gen: number): void {
    if (gen !== this.generation) return;
    const wasConnected = this.statusInfo.status === 'connected';
    this.generation++;
    this.clearTimers();
    this.closeSocket();
    if (wasConnected) this.emitDisconnected('live terminé', true);
    this.scheduleRetry(this.opts.offlinePollMs ?? 30_000, 'waiting-live', 'Live terminé');
  }

  private onLost(gen: number): void {
    if (gen !== this.generation) return;
    const wasConnected = this.statusInfo.status === 'connected';
    this.generation++;
    this.clearTimers();
    this.closeSocket();
    if (wasConnected) this.emitDisconnected('connexion perdue', false);
    this.scheduleRetry(this.backoff.next(), 'reconnecting', 'Connexion perdue');
  }

  private closeSocket(): void {
    const s = this.socket;
    this.socket = null;
    if (!s) return;
    s.removeAllListeners();
    s.on('error', () => undefined);
    try {
      s.close();
    } catch {
      // already closed
    }
  }

  private emitDisconnected(reason: string, liveEnded: boolean): void {
    this.emit('event', {
      id: makeId('dis'),
      platform: 'kick',
      timestamp: Date.now(),
      type: 'disconnected',
      reason,
      liveEnded,
    });
  }

  private scheduleRetry(delayMs: number, status: 'reconnecting' | 'waiting-live', detail: string): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (!this.wanted) return;
    this.setStatus({ status, channel: this.channel, detail, retryAt: Date.now() + delayMs });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.attempt();
    }, delayMs);
  }

  private clearTimers(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.retryTimer = this.pollTimer = this.pingTimer = null;
  }
}

/** Default transport: Node's fetch and the `ws` package. */
export function defaultKickTransport(): Pick<KickConnectorOptions, 'fetchJson' | 'createSocket'> {
  return {
    fetchJson: async (url) => {
      const res = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new HttpError(res.status);
      return res.json();
    },
    createSocket: (url) => new WebSocket(url, { handshakeTimeout: 15_000 }),
  };
}
