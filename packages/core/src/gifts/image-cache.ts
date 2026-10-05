import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { GiftInfo } from '@toktok/shared';

/** Only TikTok CDN hosts are downloaded (no arbitrary URL fetching). */
const ALLOWED_HOST = /(^|\.)(tiktokcdn\.com|tiktokcdn-[a-z0-9-]+\.com|ibyteimg\.com)$/i;
const SAFE_ID = /^[\w-]{1,64}$/;
const MAX_BYTES = 2 * 1024 * 1024;

export function isAllowedGiftImageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && ALLOWED_HOST.test(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Local copy of gift images, so the app and overlays keep working offline and
 * do not hit the CDN on every alert. Files are named after the gift id.
 */
export class GiftImageCache {
  private readonly known = new Set<string>();
  private readonly inflight = new Map<string, Promise<boolean>>();

  constructor(
    readonly dir: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async init(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    for (const f of await fs.readdir(this.dir)) if (f.endsWith('.img')) this.known.add(f.slice(0, -4));
  }

  has(giftId: string): boolean {
    return this.known.has(giftId);
  }

  filePath(giftId: string): string | null {
    return SAFE_ID.test(giftId) ? path.join(this.dir, `${giftId}.img`) : null;
  }

  /** Downloads the image if missing. Never throws. */
  ensure(gift: GiftInfo): Promise<boolean> {
    if (this.known.has(gift.id)) return Promise.resolve(true);
    const file = this.filePath(gift.id);
    if (!file || !gift.imageUrl || !isAllowedGiftImageUrl(gift.imageUrl)) return Promise.resolve(false);
    let p = this.inflight.get(gift.id);
    if (!p) {
      p = this.download(gift.imageUrl, file)
        .then(() => {
          this.known.add(gift.id);
          return true;
        })
        .catch(() => false)
        .finally(() => this.inflight.delete(gift.id));
      this.inflight.set(gift.id, p);
    }
    return p;
  }

  async ensureMany(gifts: GiftInfo[], concurrency = 4): Promise<number> {
    let ok = 0;
    const queue = [...gifts];
    await Promise.all(
      Array.from({ length: concurrency }, async () => {
        for (let g = queue.shift(); g; g = queue.shift()) if (await this.ensure(g)) ok++;
      }),
    );
    return ok;
  }

  private async download(url: string, file: string): Promise<void> {
    const res = await this.fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = res.headers.get('content-type') ?? '';
    if (!type.startsWith('image/')) throw new Error('not an image');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error('too large');
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, buf);
    await fs.rename(tmp, file);
  }
}
