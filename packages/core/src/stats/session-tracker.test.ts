import type { LiveEvent, Platform } from '@toktok/shared';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/database';
import { SessionsRepo } from '../db/repositories';
import { SessionTracker } from './session-tracker';

const base = (platform: Platform) => ({ id: 'x', platform, timestamp: 0 });
const connected = (platform: Platform, channel: string): LiveEvent => ({
  ...base(platform),
  type: 'connected',
  channel,
});
const ended = (platform: Platform): LiveEvent => ({
  ...base(platform),
  type: 'disconnected',
  liveEnded: true,
});
const viewers = (platform: Platform, count: number): LiveEvent => ({
  ...base(platform),
  type: 'viewerCount',
  count,
});

describe('SessionTracker', () => {
  it('keeps one session when TikTok and Kick are live together', () => {
    const t = new SessionTracker(new SessionsRepo(openDatabase(':memory:')));
    expect(t.handle(connected('tiktok', 'me'))).toBe(true);
    const id = t.get().sessionId;
    expect(t.handle(connected('kick', 'me-kick'))).toBe(false);
    expect(t.get().sessionId).toBe(id);
    t.handle(viewers('tiktok', 100));
    t.handle(viewers('kick', 40));
    expect(t.get().viewers).toBe(140);
    t.handle(ended('tiktok'));
    expect(t.get()).toMatchObject({ sessionId: id, viewers: 40 });
    t.handle(ended('kick'));
    expect(t.get().sessionId).toBeNull();
  });

  it('starts a new session when a platform switches channel', () => {
    const t = new SessionTracker(new SessionsRepo(openDatabase(':memory:')));
    t.handle(connected('tiktok', 'a'));
    const id = t.get().sessionId;
    expect(t.handle(connected('tiktok', 'a'))).toBe(false);
    expect(t.handle(connected('tiktok', 'b'))).toBe(true);
    expect(t.get().sessionId).not.toBe(id);
  });
});
