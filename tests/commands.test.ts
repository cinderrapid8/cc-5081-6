import { describe, expect, it } from 'vitest';
import { SummonKernel } from '../src/kernel/kernel.js';
import { subordinatePoolKey, summonPoolKey } from '../src/kernel/quota.js';

function setup() {
  const kernel = new SummonKernel();
  const akai = kernel.registerPlayer('阿凯');
  const betty = kernel.registerPlayer('贝蒂');
  const boar = kernel.registerHostile('野猪');
  const wolf2 = kernel.registerHostile('野狼');
  kernel.requestSummon(akai, { name: '苍狼' });
  kernel.advanceTick();
  return { kernel, akai, betty, boar, wolf2, summon: 'summon-1' };
}

describe('command routing', () => {
  it('accepts commands from the ownership chain and rejects outsiders', () => {
    const { kernel, akai, betty, boar, summon } = setup();
    expect(kernel.issueCommand(akai, summon, { type: 'attack', targetId: boar }).ok).toBe(true);
    expect(kernel.issueCommand(betty, summon, { type: 'attack', targetId: boar }).ok).toBe(false);
    expect(kernel.issueCommand(boar, summon, { type: 'attack', targetId: boar }).ok).toBe(false);
  });

  it('restricts subordinate targets to the owner’s current target', () => {
    const { kernel, akai, boar, wolf2, summon } = setup();
    kernel.issueCommand(akai, summon, { type: 'attack', targetId: boar });
    kernel.requestSubordinate(summon, { name: '炮台' });
    kernel.advanceTick();
    const sub = 'subordinate-1';

    // inherited at spawn
    expect(kernel.entityView(sub)!.currentTargetId).toBe(boar);
    expect(kernel.issueCommand(akai, sub, { type: 'attack', targetId: boar }).ok).toBe(true);
    const restricted = kernel.issueCommand(akai, sub, { type: 'attack', targetId: wolf2 });
    expect(restricted.ok).toBe(false);
    if (!restricted.ok) expect(restricted.why).toContain('current target');
  });

  it('propagates new targets and stances from summon to subordinates', () => {
    const { kernel, akai, boar, wolf2, summon } = setup();
    kernel.issueCommand(akai, summon, { type: 'attack', targetId: boar });
    kernel.requestSubordinate(summon, { name: '炮台' });
    kernel.advanceTick();

    kernel.issueCommand(akai, summon, { type: 'attack', targetId: wolf2 });
    expect(kernel.entityView('subordinate-1')!.currentTargetId).toBe(wolf2);

    kernel.issueCommand(akai, summon, { type: 'set-stance', stance: 'aggressive' });
    expect(kernel.entityView('subordinate-1')!.stance).toBe('aggressive');
  });

  it('refuses commands to exiting entities and to hostiles', () => {
    const { kernel, akai, boar, summon } = setup();
    kernel.dismiss(summon, akai);
    expect(kernel.issueCommand(akai, summon, { type: 'attack', targetId: boar }).ok).toBe(false);
    expect(kernel.issueCommand(akai, boar, { type: 'attack', targetId: boar }).ok).toBe(false);
  });
});

describe('owner temporarily unavailable', () => {
  it('falls back to autonomous command without touching ownership or quota', () => {
    const { kernel, akai, boar, summon } = setup();
    kernel.requestSubordinate(summon, { name: '炮台' });
    kernel.advanceTick();
    kernel.issueCommand(akai, summon, { type: 'attack', targetId: boar });

    kernel.setPlayerAvailability(akai, false);
    for (const id of [summon, 'subordinate-1']) {
      const view = kernel.entityView(id)!;
      expect(view.status).toBe('active');
      expect(view.commanderId).toBe(id); // self-directed
      expect(view.commandWhy).toContain('unavailable');
      expect(view.ownerId).not.toBeNull();
    }
    expect(kernel.quota.usage(summonPoolKey(akai)).used).toBe(1);
    expect(kernel.quota.usage(subordinatePoolKey(summon)).used).toBe(1);

    // effects recorded during the outage still attribute to the owner
    const effect = kernel.recordEffect(summon, 'damage', '自主攻击');
    const explanation = kernel.explainEffect(effect.effectId);
    expect(explanation.ok && explanation.value.legalSourceId).toBe(akai);

    kernel.setPlayerAvailability(akai, true);
    expect(kernel.entityView(summon)!.commanderId).toBe(akai);
    expect(kernel.entityView('subordinate-1')!.commanderId).toBe(summon);
  });

  it('permanent departure recycles the whole tree with owner-left reasons', () => {
    const { kernel, akai, summon } = setup();
    kernel.requestSubordinate(summon, { name: '炮台' });
    kernel.advanceTick();
    kernel.removePlayer(akai);

    expect(kernel.entityView(summon)!.recycleReason).toEqual({
      type: 'owner-recycled',
      ownerId: akai,
    });
    expect(kernel.entityView('subordinate-1')!.recycleReason).toEqual({
      type: 'owner-recycled',
      ownerId: summon,
    });
    expect(kernel.entityView(akai)!.recycleReason).toEqual({ type: 'owner-left', ownerId: akai });
    expect(kernel.quota.usage(summonPoolKey(akai)).used).toBe(0);
  });
});
