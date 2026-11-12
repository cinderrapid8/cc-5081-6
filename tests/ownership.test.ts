import { describe, expect, it } from 'vitest';
import { SummonKernel } from '../src/kernel/kernel.js';
import { subordinatePoolKey, summonPoolKey } from '../src/kernel/quota.js';
import { OwnershipGraph } from '../src/kernel/ownership.js';

function spawnOne(kernel: SummonKernel, playerId: string, name?: string): string {
  kernel.requestSummon(playerId, { name });
  kernel.advanceTick();
  const accepted = [...kernel.getEvents()].reverse().find((e) => e.type === 'request-accepted');
  if (!accepted || accepted.type !== 'request-accepted') throw new Error('spawn failed');
  return accepted.entityId;
}

describe('ownership graph', () => {
  it('rejects self-ownership, cycles and depth overflow', () => {
    const graph = new OwnershipGraph(2);
    graph.attach('s1', 'p1');
    graph.attach('sub1', 's1');

    expect(graph.canAttach('p1', 's1').ok).toBe(false); // root under its own summon: cycle
    expect(graph.canAttach('s1', 'sub1').ok).toBe(false); // summon under its subordinate: cycle
    expect(graph.canAttach('s1', 's1').ok).toBe(false); // self
    expect(graph.canAttach('x', 'sub1').ok).toBe(false); // depth 3 overflow

    // queries still terminate after rejected attempts
    expect(graph.chainToRoot('sub1')).toEqual(['sub1', 's1', 'p1']);
    expect(graph.rootOf('sub1')).toBe('p1');
  });

  it('keeps ancestor queries terminable across reparenting', () => {
    const graph = new OwnershipGraph(2);
    graph.attach('s1', 'p1');
    graph.attach('s2', 'p2');
    graph.attach('s1', 'p2');
    expect(graph.chainToRoot('s1')).toEqual(['s1', 'p2']);
    expect(graph.isAncestorOrSelf('p2', 's1')).toBe(true);
    expect(graph.isAncestorOrSelf('p1', 's1')).toBe(false);
  });
});

describe('ownership transfer vs destruction', () => {
  it('transfer keeps identity, moves quota and re-roots the command chain', () => {
    const kernel = new SummonKernel();
    const akai = kernel.registerPlayer('阿凯');
    const betty = kernel.registerPlayer('贝蒂');
    const wolf = spawnOne(kernel, akai, '苍狼');

    const result = kernel.transferOwnership(wolf, betty);
    expect(result.ok).toBe(true);

    const view = kernel.entityView(wolf)!;
    expect(view.status).toBe('active');
    expect(view.ownerId).toBe(betty);
    expect(view.commanderId).toBe(betty);
    expect(kernel.quota.usage(summonPoolKey(akai)).used).toBe(0);
    expect(kernel.quota.usage(summonPoolKey(betty)).used).toBe(1);
    expect(kernel.ownership.rootOf(wolf)).toBe(betty);
  });

  it('rejects transfer into a full pool without changing anything', () => {
    const kernel = new SummonKernel({ summonCap: 1 });
    const akai = kernel.registerPlayer('阿凯');
    const betty = kernel.registerPlayer('贝蒂');
    const wolf = spawnOne(kernel, akai, '苍狼');
    spawnOne(kernel, betty, '贝蒂的狼');

    const result = kernel.transferOwnership(wolf, betty);
    expect(result.ok).toBe(false);
    const view = kernel.entityView(wolf)!;
    expect(view.ownerId).toBe(akai);
    expect(kernel.quota.usage(summonPoolKey(akai)).used).toBe(1);
    expect(kernel.quota.usage(summonPoolKey(betty)).used).toBe(1);
  });

  it('rejects transfers that would create a cycle or break depth limits', () => {
    const kernel = new SummonKernel();
    const akai = kernel.registerPlayer('阿凯');
    const wolf = spawnOne(kernel, akai, '苍狼');
    kernel.requestSubordinate(wolf, { name: '炮台' });
    kernel.advanceTick();

    expect(kernel.transferOwnership(wolf, wolf).ok).toBe(false);
    expect(kernel.transferOwnership(wolf, 'subordinate-1').ok).toBe(false);
    expect(kernel.transferOwnership('subordinate-1', akai).ok).toBe(false);
    expect(kernel.transferOwnership(akai, wolf).ok).toBe(false);

    expect(kernel.entityView(wolf)!.ownerId).toBe(akai);
    expect(kernel.ownership.chainToRoot('subordinate-1')).toEqual(['subordinate-1', wolf, akai]);
  });

  it('moves a summon together with its subordinates to the new owner', () => {
    const kernel = new SummonKernel();
    const akai = kernel.registerPlayer('阿凯');
    const betty = kernel.registerPlayer('贝蒂');
    const golem = spawnOne(kernel, akai, '魔像');
    kernel.requestSubordinate(golem, { name: '炮台' });
    kernel.advanceTick();

    expect(kernel.transferOwnership(golem, betty).ok).toBe(true);
    expect(kernel.ownership.chainToRoot('subordinate-1')).toEqual(['subordinate-1', golem, betty]);
    expect(kernel.quota.usage(subordinatePoolKey(golem)).used).toBe(1);
  });
});
