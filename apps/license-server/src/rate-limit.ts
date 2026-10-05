/** Fixed-window counter per key (IP, email…). In memory: one Railway instance is enough here. */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Counts a hit; returns false when the key is over the limit. */
  hit(key: string): boolean {
    const t = this.now();
    const e = this.hits.get(key);
    if (!e || e.resetAt <= t) {
      if (this.hits.size > 50_000) this.sweep(t);
      this.hits.set(key, { count: 1, resetAt: t + this.windowMs });
      return true;
    }
    e.count++;
    return e.count <= this.limit;
  }

  /** True when the key already used up its window (without counting a new hit). */
  blocked(key: string): boolean {
    const e = this.hits.get(key);
    return Boolean(e && e.resetAt > this.now() && e.count >= this.limit);
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  private sweep(t: number): void {
    for (const [k, e] of this.hits) if (e.resetAt <= t) this.hits.delete(k);
  }
}
