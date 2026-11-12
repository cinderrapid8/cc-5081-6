import { describe, expect, it } from 'vitest';
import { SummonKernel } from '../src/kernel/kernel.js';
import { SCENARIOS } from '../src/scenes/scenarios.js';

function assertInvariants(kernel: SummonKernel, context: string) {
  // quota never exceeds cap, never negative
  for (const usage of kernel.quota.all()) {
    expect(usage.used, `${context}: quota ${usage.key}`).toBeLessThanOrEqual(usage.cap);
    expect(usage.used, `${context}: quota ${usage.key}`).toBeGreaterThanOrEqual(0);
  }
  // no dangling references from live entities
  for (const view of kernel.listViews()) {
    if (view.status === 'recycled') continue;
    if (view.ownerId) {
      const owner = kernel.entityView(view.ownerId);
      expect(owner, `${context}: owner of ${view.id}`).toBeTruthy();
      expect(owner!.status, `${context}: owner of ${view.id} recycled`).not.toBe('recycled');
    }
    if (view.commanderId) {
      const commander = kernel.entityView(view.commanderId);
      expect(commander, `${context}: commander of ${view.id}`).toBeTruthy();
    }
    if (view.currentTargetId) {
      expect(
        kernel.entityView(view.currentTargetId),
        `${context}: target of ${view.id}`,
      ).toBeTruthy();
    }
  }
  // every tombstone carries a recycle reason
  for (const view of kernel.listViews()) {
    if (view.status === 'recycled') {
      expect(view.recycleReason, `${context}: ${view.id} missing recycle reason`).toBeTruthy();
    }
  }
}

describe('scenario playback invariants', () => {
  for (const scenario of SCENARIOS) {
    it(`holds invariants through: ${scenario.title}`, () => {
      const kernel = new SummonKernel();
      const gen = scenario.run(kernel);
      let beats = 0;
      while (!gen.next().done) {
        beats += 1;
        assertInvariants(kernel, `${scenario.id} beat ${beats}`);
        expect(beats).toBeLessThan(100);
      }
      assertInvariants(kernel, `${scenario.id} final`);
      expect(beats).toBeGreaterThan(2);
    });
  }

  it('kernel state survives view teardown: rebind by id after discarding views', () => {
    const kernel = new SummonKernel();
    const akai = kernel.registerPlayer('阿凯');
    kernel.requestSummon(akai, { name: '苍狼' });
    kernel.advanceTick();
    const snapshot = kernel.listViews();
    // simulate view-layer teardown: drop every view object, keep only ids
    const ids = snapshot.map((v) => v.id);
    for (const id of ids) {
      expect(kernel.entityView(id)).toBeTruthy();
    }
    const effect = kernel.recordEffect('summon-1', 'damage', '撕咬');
    kernel.removePlayer(akai);
    // business query after teardown still resolves the legal source
    const explanation = kernel.explainEffect(effect.effectId);
    expect(explanation.ok && explanation.value.legalSourceId).toBe(akai);
  });
});
