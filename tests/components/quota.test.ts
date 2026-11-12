import { describe, expect, it } from 'vitest';
import { QuotaLedger, pickReplacementVictim } from '../../src/kernel/quota.js';

/**
 * Standalone quota-accounting fixture: no kernel, no DOM, no timers. The
 * ledger is a synchronous slot counter; underflow (a second release of the
 * same slot) throws instead of silently drifting.
 */
describe('quota ledger standalone', () => {
  it('acquires up to the cap and refuses beyond it', () => {
    const ledger = new QuotaLedger();
    ledger.define('summon:p1', 2);
    expect(ledger.acquire('summon:p1')).toBe(true);
    expect(ledger.acquire('summon:p1')).toBe(true);
    expect(ledger.acquire('summon:p1')).toBe(false);
    expect(ledger.usage('summon:p1')).toEqual({ key: 'summon:p1', used: 2, cap: 2 });
  });

  it('throws on double release of the same slot instead of going negative', () => {
    const ledger = new QuotaLedger();
    ledger.define('summon:p1', 1);
    ledger.acquire('summon:p1');
    ledger.release('summon:p1');
    expect(() => ledger.release('summon:p1')).toThrow(/underflow/);
    expect(ledger.usage('summon:p1').used).toBe(0);
  });

  it('rejects operations on undefined pools', () => {
    const ledger = new QuotaLedger();
    expect(() => ledger.acquire('nope')).toThrow(/not defined/);
    expect(ledger.usage('nope')).toEqual({ key: 'nope', used: 0, cap: 0 });
  });
});

describe('pickReplacementVictim (replace-oldest policy)', () => {
  it('prefers the oldest active holder', () => {
    const victim = pickReplacementVictim([
      { id: 'c', spawnedAtTick: 3, status: 'active' },
      { id: 'a', spawnedAtTick: 1, status: 'active' },
      { id: 'b', spawnedAtTick: 2, status: 'active' },
    ]);
    expect(victim).toBe('a');
  });

  it('falls back to the oldest exiting holder when none is active', () => {
    const victim = pickReplacementVictim([
      { id: 'x', spawnedAtTick: 4, status: 'exiting' },
      { id: 'y', spawnedAtTick: 2, status: 'exiting' },
    ]);
    expect(victim).toBe('y');
  });

  it('prefers an active holder over an older exiting one', () => {
    const victim = pickReplacementVictim([
      { id: 'old-exiting', spawnedAtTick: 1, status: 'exiting' },
      { id: 'new-active', spawnedAtTick: 9, status: 'active' },
    ]);
    expect(victim).toBe('new-active');
  });

  it('breaks spawn-tick ties by id and returns null for empty pools', () => {
    expect(
      pickReplacementVictim([
        { id: 'b', spawnedAtTick: 1, status: 'active' },
        { id: 'a', spawnedAtTick: 1, status: 'active' },
      ]),
    ).toBe('a');
    expect(pickReplacementVictim([])).toBeNull();
  });
});
