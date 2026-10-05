import type { GiftInfo } from '@toktok/shared';
import type { GiftCatalogRepo } from '../db/repositories';

/** In-memory gift catalog backed by the SQLite cache. */
export class GiftCatalog {
  private readonly byId = new Map<string, GiftInfo>();

  constructor(
    private readonly repo: GiftCatalogRepo,
    private readonly platform: string,
  ) {
    for (const g of repo.list(platform)) this.byId.set(g.id, g);
  }

  get(id: string): GiftInfo | undefined {
    return this.byId.get(id);
  }

  list(): GiftInfo[] {
    return [...this.byId.values()].sort((a, b) => a.diamonds - b.diamonds || a.name.localeCompare(b.name));
  }

  /** Learns gifts seen live (keeps the cache fresh even without a full refresh). */
  learn(gift: GiftInfo): void {
    const known = this.byId.get(gift.id);
    if (known && known.name === gift.name && known.diamonds === gift.diamonds) return;
    if (!gift.name || gift.diamonds <= 0) return;
    const merged = { ...known, ...gift };
    this.byId.set(gift.id, merged);
    this.repo.upsertMany(this.platform, [merged]);
  }

  replaceAll(gifts: GiftInfo[]): void {
    this.repo.upsertMany(this.platform, gifts);
    for (const g of gifts) this.byId.set(g.id, g);
  }

  isStale(maxAgeMs: number): boolean {
    const t = this.repo.lastUpdated(this.platform);
    return t === null || Date.now() - t > maxAgeMs;
  }
}
