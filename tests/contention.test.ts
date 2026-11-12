import { describe, expect, it } from 'vitest';
import { SummonKernel } from '../src/kernel/kernel.js';
import { summonPoolKey } from '../src/kernel/quota.js';

describe('same-tick contention', () => {
  it('admits exactly one request per free slot, deterministically by submission order', () => {
    const kernel = new SummonKernel({ summonCap: 2 });
    const player = kernel.registerPlayer('阿凯');
    kernel.requestSummon(player, { name: '先手' });
    kernel.advanceTick();

    const a = kernel.requestSummon(player, { name: '甲', onFull: 'reject' });
    const b = kernel.requestSummon(player, { name: '乙', onFull: 'reject' });
    const c = kernel.requestSummon(player, { name: '丙', onFull: 'reject' });
    kernel.advanceTick();

    const events = kernel.getEvents();
    const accepted = events.filter((e) => e.type === 'request-accepted').map((e) => e.requestId);
    const rejected = events.filter((e) => e.type === 'request-rejected').map((e) => e.requestId);
    expect(accepted).toContain(a);
    expect(rejected).toEqual(expect.arrayContaining([b, c]));
    expect(kernel.quota.usage(summonPoolKey(player)).used).toBe(2);
  });

  it('never over-commits quota when many requests race for full pools', () => {
    const kernel = new SummonKernel({ summonCap: 3 });
    const player = kernel.registerPlayer('阿凯');
    for (let i = 0; i < 12; i++) {
      kernel.requestSummon(player, { name: `竞争${i}`, onFull: 'reject' });
    }
    kernel.advanceTick();
    const usage = kernel.quota.usage(summonPoolKey(player));
    expect(usage.used).toBe(3);
    const live = kernel.listViews().filter((v) => v.kind === 'summon' && v.status === 'active');
    expect(live).toHaveLength(3);
  });

  it('rejects requests made while the owner is temporarily unavailable', () => {
    const kernel = new SummonKernel();
    const player = kernel.registerPlayer('阿凯');
    kernel.setPlayerAvailability(player, false);
    const req = kernel.requestSummon(player, { onFull: 'reject' });
    kernel.advanceTick();
    const rejected = kernel
      .getEvents()
      .find((e) => e.type === 'request-rejected' && e.requestId === req);
    expect(rejected && rejected.type === 'request-rejected' && rejected.why).toContain(
      'unavailable',
    );
  });
});
