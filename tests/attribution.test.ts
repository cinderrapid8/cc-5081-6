import { describe, expect, it } from 'vitest';
import { SummonKernel } from '../src/kernel/kernel.js';

describe('effect attribution', () => {
  it('resolves the legal source after the whole tree was recycled', () => {
    const kernel = new SummonKernel({ exitGraceTicks: 0 });
    const akai = kernel.registerPlayer('阿凯');
    kernel.requestSummon(akai, { name: '魔像' });
    kernel.advanceTick();
    kernel.requestSubordinate('summon-1', { name: '炮台' });
    kernel.advanceTick();

    const effect = kernel.recordEffect('subordinate-1', 'damage', '炮台射击 42 点');
    expect(effect.chain).toEqual(['subordinate-1', 'summon-1', akai]);

    kernel.removePlayer(akai); // recycle everything
    expect(kernel.entityView('subordinate-1')!.status).toBe('recycled');
    expect(kernel.entityView('summon-1')!.status).toBe('recycled');
    expect(kernel.entityView(akai)!.status).toBe('recycled');

    const explanation = kernel.explainEffect(effect.effectId);
    expect(explanation.legalSourceId).toBe(akai);
    expect(explanation.legalSourceName).toBe('阿凯');
    expect(explanation.chain.map((c) => c.name)).toEqual(['炮台', '魔像', '阿凯']);
    expect(explanation.chain.every((c) => c.status === 'recycled')).toBe(true);
    expect(explanation.chain[1]!.recycleReason).toEqual({ type: 'owner-recycled', ownerId: akai });
  });

  it('freezes the chain at record time: transfer does not rewrite past effects', () => {
    const kernel = new SummonKernel();
    const akai = kernel.registerPlayer('阿凯');
    const betty = kernel.registerPlayer('贝蒂');
    kernel.requestSummon(akai, { name: '苍狼' });
    kernel.advanceTick();

    const before = kernel.recordEffect('summon-1', 'damage', '转让前撕咬');
    kernel.transferOwnership('summon-1', betty);
    const after = kernel.recordEffect('summon-1', 'damage', '转让后撕咬');

    expect(kernel.explainEffect(before.effectId).legalSourceId).toBe(akai);
    expect(kernel.explainEffect(after.effectId).legalSourceId).toBe(betty);
  });

  it('rejects effects from inactive sources', () => {
    const kernel = new SummonKernel({ exitGraceTicks: 0 });
    const akai = kernel.registerPlayer('阿凯');
    kernel.requestSummon(akai, { name: '苍狼' });
    kernel.advanceTick();
    kernel.dismiss('summon-1', akai);
    expect(() => kernel.recordEffect('summon-1', 'damage', '幽灵攻击')).toThrow();
  });
});
