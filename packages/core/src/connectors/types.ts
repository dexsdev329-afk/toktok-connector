import type { GiftInfo, LiveEvent, Platform } from '@toktok/shared';

export type ConnectorStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  /** Channel exists but is not live: we poll until it goes live. */
  | 'waiting-live'
  | 'error';

export interface ConnectorStatusInfo {
  status: ConnectorStatus;
  channel: string | null;
  detail?: string;
  /** Next retry timestamp when reconnecting / waiting. */
  retryAt?: number;
}

export interface ConnectorEvents {
  event: LiveEvent;
  status: ConnectorStatusInfo;
}

/** Common interface for every live platform (TikTok, Kick, simulator...). */
export interface LiveConnector {
  readonly platform: Platform;
  connect(channel: string): Promise<void>;
  disconnect(): Promise<void>;
  getStatus(): ConnectorStatusInfo;
  /** Gift catalog of the platform, when available. */
  fetchGifts?(): Promise<GiftInfo[]>;
  on<K extends keyof ConnectorEvents>(topic: K, listener: (payload: ConnectorEvents[K]) => void): () => void;
}

export abstract class BaseConnector implements LiveConnector {
  abstract readonly platform: Platform;
  protected statusInfo: ConnectorStatusInfo = { status: 'idle', channel: null };
  private readonly listeners: { [K in keyof ConnectorEvents]: Set<(p: ConnectorEvents[K]) => void> } = {
    event: new Set(),
    status: new Set(),
  };

  abstract connect(channel: string): Promise<void>;
  abstract disconnect(): Promise<void>;

  getStatus(): ConnectorStatusInfo {
    return this.statusInfo;
  }

  on<K extends keyof ConnectorEvents>(topic: K, listener: (payload: ConnectorEvents[K]) => void): () => void {
    this.listeners[topic].add(listener);
    return () => this.listeners[topic].delete(listener);
  }

  protected emit<K extends keyof ConnectorEvents>(topic: K, payload: ConnectorEvents[K]): void {
    for (const l of [...this.listeners[topic]]) {
      try {
        l(payload);
      } catch {
        // listeners are isolated
      }
    }
  }

  protected setStatus(info: ConnectorStatusInfo): void {
    this.statusInfo = info;
    this.emit('status', info);
  }
}

/** Exponential backoff with full jitter. */
export class Backoff {
  private attempt = 0;
  constructor(
    private readonly baseMs = 2000,
    private readonly maxMs = 60_000,
    private readonly random: () => number = Math.random,
  ) {}

  next(): number {
    const cap = Math.min(this.maxMs, this.baseMs * 2 ** this.attempt);
    this.attempt++;
    // Keep at least half of the cap to avoid hammering on "lucky" small jitters.
    return Math.round(cap / 2 + (this.random() * cap) / 2);
  }

  reset(): void {
    this.attempt = 0;
  }

  get attempts(): number {
    return this.attempt;
  }
}
