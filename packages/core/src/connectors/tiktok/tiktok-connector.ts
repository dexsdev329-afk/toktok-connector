import { makeId, type GiftInfo, type LiveEvent } from '@toktok/shared';
import { GiftAggregator, type StreakMode } from '../../gifts/aggregator';
import { Backoff, BaseConnector } from '../types';
import {
  mapChat,
  mapGiftList,
  mapGiftObservation,
  mapLike,
  mapSocial,
  mapSubscribe,
  mapViewerCount,
} from './mapper';

/**
 * The subset of tiktok-live-connector's TikTokLiveConnection we rely on.
 * Keeping it narrow makes the connector testable with a fake client.
 */
export interface TikTokClientLike {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  removeAllListeners(event?: string): unknown;
  connect(): Promise<unknown>;
  disconnect(): Promise<unknown> | unknown;
  fetchAvailableGifts?(): Promise<unknown>;
}

export interface TikTokClientOptions {
  signApiKey?: string;
}

export type TikTokClientFactory = (username: string, options: TikTokClientOptions) => TikTokClientLike;

export interface TikTokConnectorOptions {
  createClient: TikTokClientFactory;
  signApiKey?: string;
  streakMode?: StreakMode;
  /** Gift lookup (cached catalog) used to fill missing names/values. */
  lookupGift?: (id: string) => GiftInfo | undefined;
  /** Called with every gift seen live, to keep the catalog fresh. */
  onGiftSeen?: (gift: GiftInfo) => void;
  /** Poll interval while the creator is not live (ms). */
  offlinePollMs?: number;
  backoff?: Backoff;
}

/** Library event names (WebcastEvent / ControlEvent string values). */
const EV = {
  connected: 'connected',
  disconnected: 'disconnected',
  error: 'error',
  streamEnd: 'streamEnd',
  chat: 'chat',
  gift: 'gift',
  like: 'like',
  follow: 'follow',
  share: 'share',
  subscribe: 'subNotify',
  roomUser: 'roomUser',
} as const;

function errorName(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { name?: unknown; constructor?: { name?: unknown } };
    if (typeof e.name === 'string' && e.name !== 'Error') return e.name;
    if (typeof e.constructor?.name === 'string') return e.constructor.name;
  }
  return 'Error';
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function normalizeUsername(input: string): string {
  let s = input.trim();
  const m = /tiktok\.com\/@([^/?#]+)/i.exec(s);
  if (m) s = m[1]!;
  return s.replace(/^@/, '').trim();
}

/**
 * TikTok LIVE connector built on tiktok-live-connector.
 * - automatic reconnection with exponential backoff + jitter
 * - live end detection (streamEnd) and polling until the creator is live again
 * - gift streak aggregation
 */
export class TikTokConnector extends BaseConnector {
  readonly platform = 'tiktok' as const;
  private client: TikTokClientLike | null = null;
  private channel: string | null = null;
  private wanted = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private liveEnded = false;
  private readonly backoff: Backoff;
  private readonly aggregator: GiftAggregator;
  private generation = 0;

  constructor(private readonly opts: TikTokConnectorOptions) {
    super();
    this.backoff = opts.backoff ?? new Backoff();
    this.aggregator = new GiftAggregator((e) => this.emit('event', e), opts.streakMode ?? 'end');
  }

  setStreakMode(mode: StreakMode): void {
    this.aggregator.setMode(mode);
  }

  async connect(channel: string): Promise<void> {
    const username = normalizeUsername(channel);
    if (!/^[\w.]{2,24}$/.test(username)) throw new Error('Nom d’utilisateur TikTok invalide');
    await this.disconnect();
    this.channel = username;
    this.wanted = true;
    this.backoff.reset();
    await this.attempt();
  }

  async disconnect(): Promise<void> {
    this.wanted = false;
    this.generation++;
    this.clearRetry();
    this.aggregator.flushAll();
    const client = this.client;
    this.client = null;
    if (client) {
      client.removeAllListeners();
      try {
        await client.disconnect();
      } catch {
        // already closed
      }
      this.emitDisconnected('manual', false);
    }
    this.setStatus({ status: 'idle', channel: this.channel });
  }

  async fetchGifts(): Promise<GiftInfo[]> {
    const username = this.channel;
    const client = this.client ?? (username ? this.opts.createClient(username, this.clientOptions()) : null);
    if (!client?.fetchAvailableGifts) return [];
    return mapGiftList(await client.fetchAvailableGifts());
  }

  private clientOptions(): TikTokClientOptions {
    return this.opts.signApiKey ? { signApiKey: this.opts.signApiKey } : {};
  }

  private async attempt(): Promise<void> {
    if (!this.wanted || !this.channel) return;
    const gen = ++this.generation;
    const channel = this.channel;
    this.setStatus({
      status: this.backoff.attempts > 0 ? 'reconnecting' : 'connecting',
      channel,
    });
    const client = this.opts.createClient(channel, this.clientOptions());
    this.client = client;
    this.liveEnded = false;
    this.bind(client, gen);
    try {
      await client.connect();
      if (gen !== this.generation) return;
      this.backoff.reset();
      this.setStatus({ status: 'connected', channel });
      this.emit('event', { id: makeId('con'), platform: 'tiktok', timestamp: Date.now(), type: 'connected', channel });
    } catch (err) {
      if (gen !== this.generation) return;
      client.removeAllListeners();
      this.client = null;
      const name = errorName(err);
      if (name === 'UserOfflineError' || /offline|not live|isn't online/i.test(errorMessage(err))) {
        this.scheduleRetry(this.opts.offlinePollMs ?? 30_000, 'waiting-live', 'Le live n’a pas commencé');
      } else if (name === 'InvalidUniqueIdError') {
        this.wanted = false;
        this.setStatus({ status: 'error', channel, detail: 'Compte TikTok introuvable' });
      } else {
        this.scheduleRetry(this.backoff.next(), 'reconnecting', `${name}: ${errorMessage(err)}`);
      }
    }
  }

  private bind(client: TikTokClientLike, gen: number): void {
    const guard =
      <A extends unknown[]>(fn: (...args: A) => void) =>
      (...args: A) => {
        if (gen === this.generation) fn(...args);
      };
    const push = (e: LiveEvent) => this.emit('event', e);

    client.on(EV.chat, guard((m: unknown) => push(mapChat(m))));
    client.on(EV.like, guard((m: unknown) => push(mapLike(m))));
    client.on(EV.follow, guard((m: unknown) => push(mapSocial(m, 'follow'))));
    client.on(EV.share, guard((m: unknown) => push(mapSocial(m, 'share'))));
    client.on(EV.subscribe, guard((m: unknown) => push(mapSubscribe(m))));
    client.on(EV.roomUser, guard((m: unknown) => push(mapViewerCount(m))));
    client.on(
      EV.gift,
      guard((m: unknown) => {
        const obs = mapGiftObservation(m, this.opts.lookupGift);
        if (obs.gift.diamonds > 0) this.opts.onGiftSeen?.(obs.gift);
        this.aggregator.push(obs);
      }),
    );
    client.on(
      EV.streamEnd,
      guard(() => {
        this.liveEnded = true;
      }),
    );
    client.on(
      EV.error,
      guard((err: unknown) => {
        this.setStatus({ ...this.statusInfo, detail: errorMessage(err) });
      }),
    );
    client.on(
      EV.disconnected,
      guard(() => {
        // Only react once the connection was established (connect() errors are handled in attempt()).
        if (this.statusInfo.status !== 'connected') return;
        this.aggregator.flushAll();
        client.removeAllListeners();
        this.client = null;
        const ended = this.liveEnded;
        this.emitDisconnected(ended ? 'live terminé' : 'connexion perdue', ended);
        if (!this.wanted) return;
        if (ended) {
          this.scheduleRetry(this.opts.offlinePollMs ?? 30_000, 'waiting-live', 'Live terminé');
        } else {
          this.scheduleRetry(this.backoff.next(), 'reconnecting', 'Connexion perdue');
        }
      }),
    );
  }

  private emitDisconnected(reason: string, liveEnded: boolean): void {
    this.emit('event', {
      id: makeId('dis'),
      platform: 'tiktok',
      timestamp: Date.now(),
      type: 'disconnected',
      reason,
      liveEnded,
    });
  }

  private scheduleRetry(delayMs: number, status: 'reconnecting' | 'waiting-live', detail: string): void {
    this.clearRetry();
    if (!this.wanted) return;
    this.setStatus({ status, channel: this.channel, detail, retryAt: Date.now() + delayMs });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.attempt();
    }, delayMs);
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }
}
