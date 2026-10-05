import type { LiveEvent, TopDonor } from '@toktok/shared';
import type { SessionsRepo } from '../db/repositories';

export interface SessionSnapshot {
  sessionId: string | null;
  channel: string | null;
  likes: number;
  viewers: number;
  diamonds: number;
  followers: number;
}

/**
 * Keeps per-live statistics (top donors, likes, viewers) and persists viewer stats.
 * A session starts on "connected" and ends on a "disconnected" with liveEnded.
 * Simple reconnections keep the same session.
 */
export class SessionTracker {
  private snapshot: SessionSnapshot = {
    sessionId: null,
    channel: null,
    likes: 0,
    viewers: 0,
    diamonds: 0,
    followers: 0,
  };
  private listeners = new Set<(s: SessionSnapshot) => void>();
  private platform: string = 'tiktok';
  /** Platforms currently live in this session (TikTok and Kick can stream at the same time). */
  private readonly live = new Map<string, string>();
  private readonly viewersByPlatform = new Map<string, number>();

  constructor(private readonly sessions: SessionsRepo) {}

  onChange(l: (s: SessionSnapshot) => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  get(): SessionSnapshot {
    return this.snapshot;
  }

  topDonors(limit: number): TopDonor[] {
    return this.snapshot.sessionId ? this.sessions.topDonors(this.snapshot.sessionId, limit) : [];
  }

  /** Returns true when a new session started (callers reset per-session state). */
  handle(event: LiveEvent): boolean {
    let started = false;
    switch (event.type) {
      case 'connected': {
        const known = this.live.get(event.platform);
        // Another platform joining a running session (multistream) keeps the session;
        // the same platform switching to another channel starts a new one.
        const joins = this.snapshot.sessionId && (known === undefined || known === event.channel);
        this.live.set(event.platform, event.channel);
        if (!joins) {
          this.end();
          this.live.set(event.platform, event.channel);
          this.platform = event.platform;
          this.snapshot = {
            sessionId: this.sessions.start(event.platform, event.channel),
            channel: event.channel,
            likes: 0,
            viewers: 0,
            diamonds: 0,
            followers: 0,
          };
          started = true;
        }
        break;
      }
      case 'disconnected':
        if (event.liveEnded || event.reason === 'manual') {
          this.live.delete(event.platform);
          this.viewersByPlatform.delete(event.platform);
          if (this.live.size === 0) this.end();
          else this.snapshot = { ...this.snapshot, viewers: this.totalViewers() };
        }
        break;
      case 'gift': {
        const diamonds = event.gift.diamonds * event.count;
        this.snapshot = { ...this.snapshot, diamonds: this.snapshot.diamonds + diamonds };
        if (this.snapshot.sessionId) {
          this.sessions.addViewerStats(this.snapshot.sessionId, event.user, { diamonds, gifts: event.count });
        }
        break;
      }
      case 'like':
        this.snapshot = { ...this.snapshot, likes: this.snapshot.likes + event.count };
        if (this.snapshot.sessionId) {
          this.sessions.addViewerStats(this.snapshot.sessionId, event.user, { likes: event.count });
        }
        break;
      case 'follow':
        this.snapshot = { ...this.snapshot, followers: this.snapshot.followers + 1 };
        break;
      case 'viewerCount':
        this.viewersByPlatform.set(event.platform, event.count);
        this.snapshot = { ...this.snapshot, viewers: this.totalViewers() };
        break;
      default:
        return false;
    }
    for (const l of this.listeners) l(this.snapshot);
    return started;
  }

  /** Manual reset of the counters ("new session" button). */
  reset(): void {
    const channel = this.snapshot.channel;
    const platform = this.platform;
    const live = [...this.live];
    this.end();
    for (const [k, v] of live) this.live.set(k, v);
    if (channel) {
      this.snapshot = { ...this.snapshot, sessionId: this.sessions.start(platform, channel), channel };
    }
    for (const l of this.listeners) l(this.snapshot);
  }

  private totalViewers(): number {
    let n = 0;
    for (const v of this.viewersByPlatform.values()) n += v;
    return n;
  }

  private end(): void {
    if (this.snapshot.sessionId) this.sessions.end(this.snapshot.sessionId);
    this.live.clear();
    this.viewersByPlatform.clear();
    this.snapshot = { sessionId: null, channel: null, likes: 0, viewers: 0, diamonds: 0, followers: 0 };
  }
}
