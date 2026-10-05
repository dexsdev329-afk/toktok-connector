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
      case 'connected':
        if (!this.snapshot.sessionId || this.snapshot.channel !== event.channel) {
          this.end();
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
      case 'disconnected':
        if (event.liveEnded || event.reason === 'manual') this.end();
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
        this.snapshot = { ...this.snapshot, viewers: event.count };
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
    this.end();
    if (channel) {
      this.snapshot = { ...this.snapshot, sessionId: this.sessions.start(platform, channel), channel };
    }
    for (const l of this.listeners) l(this.snapshot);
  }

  private end(): void {
    if (this.snapshot.sessionId) this.sessions.end(this.snapshot.sessionId);
    this.snapshot = { sessionId: null, channel: null, likes: 0, viewers: 0, diamonds: 0, followers: 0 };
  }
}
