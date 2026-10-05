import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GiftImageCache, isAllowedGiftImageUrl } from './image-cache';

describe('GiftImageCache', () => {
  it('only accepts https TikTok CDN urls', () => {
    expect(isAllowedGiftImageUrl('https://p16-webcast.tiktokcdn.com/img/x.webp')).toBe(true);
    expect(isAllowedGiftImageUrl('http://p16-webcast.tiktokcdn.com/img/x.webp')).toBe(false);
    expect(isAllowedGiftImageUrl('https://evil.com/tiktokcdn.com.webp')).toBe(false);
    expect(isAllowedGiftImageUrl('https://tiktokcdn.com.evil.com/x')).toBe(false);
  });

  it('downloads once and reports cached files', async () => {
    let calls = 0;
    const fakeFetch = (async () => {
      calls++;
      return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/webp' } });
    }) as typeof fetch;
    const cache = new GiftImageCache(mkdtempSync(path.join(tmpdir(), 'gimg-')), fakeFetch);
    await cache.init();
    const gift = {
      id: '5655',
      name: 'Rose',
      diamonds: 1,
      imageUrl: 'https://p16-webcast.tiktokcdn.com/r.webp',
    };
    expect(await Promise.all([cache.ensure(gift), cache.ensure(gift)])).toEqual([true, true]);
    expect(calls).toBe(1);
    expect(cache.has('5655')).toBe(true);
    expect(await cache.ensure({ ...gift, id: '../x' })).toBe(false);
  });
});
