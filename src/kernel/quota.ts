export interface QuotaUsage {
  key: string;
  used: number;
  cap: number;
}

/**
 * Synchronous slot ledger. Slots are acquired the moment a spawn request is
 * accepted and released only when the kernel finalizes recycling — never by
 * view-layer cleanup — so delayed teardown cannot double-occupy a slot.
 */
export class QuotaLedger {
  private pools = new Map<string, { used: number; cap: number }>();

  define(key: string, cap: number): void {
    if (!this.pools.has(key)) this.pools.set(key, { used: 0, cap });
  }

  acquire(key: string): boolean {
    const pool = this.pools.get(key);
    if (!pool) throw new Error(`quota pool not defined: ${key}`);
    if (pool.used >= pool.cap) return false;
    pool.used += 1;
    return true;
  }

  release(key: string): void {
    const pool = this.pools.get(key);
    if (!pool) throw new Error(`quota pool not defined: ${key}`);
    if (pool.used <= 0) throw new Error(`quota underflow on ${key}`);
    pool.used -= 1;
  }

  usage(key: string): QuotaUsage {
    const pool = this.pools.get(key);
    if (!pool) return { key, used: 0, cap: 0 };
    return { key, used: pool.used, cap: pool.cap };
  }

  all(): QuotaUsage[] {
    return [...this.pools.entries()].map(([key, p]) => ({ key, used: p.used, cap: p.cap }));
  }
}
