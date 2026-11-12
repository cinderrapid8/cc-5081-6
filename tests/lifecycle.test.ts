import { describe, expect, it } from 'vitest';
import { SummonKernel, poolKeys } from '../src/kernel/kernel.js';

function spawnOne(kernel: SummonKernel, playerId: string, name?: string) {
  const req = kernel.requestSummon(playerId, { name });
  kernel.advanceTick();
  const accepted = kernel
    .getEvents()
    .find((e) => e.type === 'request-accepted' && e.requestId === req);
  if (!accepted || accepted.type !== 'request-accepted') throw new Error(`not accepted: ${req}`);
  return accepted.entityId;
}

describe('lifecycle', () => {
  it('spawns companions with lifespan and inherits stance/target from owner', () => {
    const kernel = new SummonKernel();
    const player = kernel.registerPlayer('阿凯');
    const boar = kernel.registerHostile('野猪');
    kernel.issueCommand(player, player, { type: 'set-stance', stance: 'aggressive' });
    kernel.issueCommand(player, player, { type: 'attack', targetId: boar });

    const wolf = spawnOne(kernel, player, '苍狼');
    const view = kernel.entityView(wolf)!;
    expect(view.lifespanRemaining).toBe(12);
    expect(view.stance).toBe('aggressive');
    expect(view.currentTargetId).toBe(boar);
    expect(view.commanderId).toBe(player);
    expect(view.commandWhy).toContain('阿凯');
  });

  it('enforces the summon cap and rejects when full with policy reject', () => {
    const kernel = new SummonKernel();
    const player = kernel.registerPlayer('阿凯');
    spawnOne(kernel, player, '一');
    spawnOne(kernel, player, '二');
    spawnOne(kernel, player, '三');

    const req = kernel.requestSummon(player, { name: '四', onFull: 'reject' });
    kernel.advanceTick();
    const rejected = kernel
      .getEvents()
      .find((e) => e.type === 'request-rejected' && e.requestId === req);
    expect(rejected).toBeTruthy();
    expect(kernel.quota.usage(poolKeys.summonPoolKey(player)).used).toBe(3);
  });

  it('consecutive replacement keeps live count at cap and tombstones the replaced', () => {
    const kernel = new SummonKernel();
    const player = kernel.registerPlayer('阿凯');
    const seen: string[] = [];
    for (let i = 0; i < 10; i++) {
      seen.push(spawnOne(kernel, player, `战宠${i}`));
      const usage = kernel.quota.usage(poolKeys.summonPoolKey(player));
      expect(usage.used).toBeLessThanOrEqual(3);
    }
    const live = kernel.listViews().filter((v) => v.kind === 'summon' && v.status !== 'recycled');
    expect(live).toHaveLength(3);
    expect(live.map((v) => v.id).sort()).toEqual([seen[7], seen[8], seen[9]].sort());

    const replaced = kernel.entityView(seen[0])!;
    expect(replaced.status).toBe('recycled');
    expect(replaced.recycleReason).toEqual({ type: 'replaced', by: seen[3] });
    // every tombstone keeps identity and reason — no anonymous companion list
    for (const id of seen.slice(0, 7)) {
      const view = kernel.entityView(id)!;
      expect(view.status).toBe('recycled');
      expect(view.recycleReason?.type).toBe('replaced');
    }
  });

  it('exiting entities keep their quota slot until the kernel finalizes recycling', () => {
    const kernel = new SummonKernel({ exitGraceTicks: 3, summonLifespan: 2, summonCap: 1 });
    const player = kernel.registerPlayer('阿凯');
    const first = spawnOne(kernel, player, '短命');

    kernel.advanceTick(); // lifespan 2 -> 1
    kernel.advanceTick(); // lifespan 1 -> 0, begins exit
    expect(kernel.entityView(first)!.status).toBe('exiting');

    // slot still held during the grace window: a reject-policy request fails
    const req = kernel.requestSummon(player, { name: '占位', onFull: 'reject' });
    kernel.advanceTick();
    expect(
      kernel.getEvents().some((e) => e.type === 'request-rejected' && e.requestId === req),
    ).toBe(true);
    expect(kernel.quota.usage(poolKeys.summonPoolKey(player)).used).toBe(1);

    kernel.advanceTick(); // grace expires, finalize
    kernel.advanceTick();
    expect(kernel.entityView(first)!.status).toBe('recycled');
    expect(kernel.entityView(first)!.recycleReason?.type).toBe('lifespan-expired');
    expect(kernel.quota.usage(poolKeys.summonPoolKey(player)).used).toBe(0);

    spawnOne(kernel, player, '后来者');
    expect(kernel.quota.usage(poolKeys.summonPoolKey(player)).used).toBe(1);
  });

  it('replace-oldest can force-finalize an exiting summon to reclaim its slot', () => {
    const kernel = new SummonKernel({ exitGraceTicks: 5, summonLifespan: 1, summonCap: 1 });
    const player = kernel.registerPlayer('阿凯');
    const first = spawnOne(kernel, player, '短命');
    kernel.advanceTick(); // expires, begins exit with finalize at tick 2+5
    expect(kernel.entityView(first)!.status).toBe('exiting');

    const second = spawnOne(kernel, player, '替换者');
    expect(kernel.entityView(first)!.recycleReason).toEqual({ type: 'replaced', by: second });
    expect(kernel.quota.usage(poolKeys.summonPoolKey(player)).used).toBe(1);
  });

  it('dismiss requires command authority and recycles after the grace period', () => {
    const kernel = new SummonKernel({ exitGraceTicks: 1 });
    const akai = kernel.registerPlayer('阿凯');
    const betty = kernel.registerPlayer('贝蒂');
    const wolf = spawnOne(kernel, akai, '苍狼');

    const denied = kernel.dismiss(wolf, betty);
    expect(denied.ok).toBe(false);
    expect(kernel.entityView(wolf)!.status).toBe('active');

    const granted = kernel.dismiss(wolf, akai);
    expect(granted.ok).toBe(true);
    kernel.advanceTick();
    const view = kernel.entityView(wolf)!;
    expect(view.status).toBe('recycled');
    expect(view.recycleReason).toEqual({ type: 'dismissed', by: akai });
  });

  it('recycling a summon cascade-recycles its subordinates with a reason', () => {
    const kernel = new SummonKernel({ exitGraceTicks: 0 });
    const player = kernel.registerPlayer('阿凯');
    const golem = spawnOne(kernel, player, '魔像');
    kernel.requestSubordinate(golem, { name: '炮台' });
    kernel.advanceTick();

    kernel.dismiss(golem, player);
    const sub = kernel.entityView('subordinate-1')!;
    expect(sub.status).toBe('recycled');
    expect(sub.recycleReason).toEqual({ type: 'owner-recycled', ownerId: golem });
    expect(kernel.quota.usage(poolKeys.subordinatePoolKey(golem)).used).toBe(0);
    expect(kernel.quota.usage(poolKeys.summonPoolKey(player)).used).toBe(0);
  });
});
