import { describe, expect, it } from 'vitest';
import { LifecycleService } from '../../src/kernel/lifecycle.js';
import { OwnershipGraph } from '../../src/kernel/ownership.js';
import { QuotaLedger } from '../../src/kernel/quota.js';
import { EntityRegistry, type EntityRecord } from '../../src/kernel/registry.js';
import type { KernelEvent } from '../../src/kernel/types.js';

class CountingLedger extends QuotaLedger {
  readonly releases: string[] = [];
  override release(key: string): void {
    this.releases.push(key);
    super.release(key);
  }
}

function record(id: string, overrides: Partial<EntityRecord> = {}): EntityRecord {
  return {
    id,
    kind: 'summon',
    name: id,
    ownerId: null,
    commanderId: id,
    commandSource: { type: 'self', why: 'self-directed' },
    stance: 'defensive',
    currentTargetId: null,
    followTargetId: null,
    lifespanRemaining: null,
    status: 'active',
    available: true,
    recycleReason: null,
    pendingRecycleReason: null,
    exitFinalizeTick: null,
    quotaKey: null,
    spawnedAtTick: 0,
    recycledAtTick: null,
    ...overrides,
  };
}

function setup(exitGraceTicks: number) {
  const registry = new EntityRegistry();
  const ownership = new OwnershipGraph(2);
  const quota = new CountingLedger();
  const events: KernelEvent[] = [];
  const lifecycle = new LifecycleService({
    registry,
    ownership,
    quota,
    emit: (event) => events.push(event),
    config: { exitGraceTicks },
  });
  return { registry, ownership, quota, events, lifecycle };
}

function plantTree(ctx: ReturnType<typeof setup>): void {
  const { registry, ownership, quota } = ctx;
  quota.define('summon:p1', 3);
  quota.define('subordinate:s1', 2);
  registry.add(record('p1', { kind: 'player' }));
  registry.add(record('s1', { ownerId: 'p1', quotaKey: 'summon:p1' }));
  registry.add(record('b1', { kind: 'subordinate', ownerId: 's1', quotaKey: 'subordinate:s1' }));
  registry.add(record('b2', { kind: 'subordinate', ownerId: 's1', quotaKey: 'subordinate:s1' }));
  ownership.attach('s1', 'p1');
  ownership.attach('b1', 's1');
  ownership.attach('b2', 's1');
  quota.acquire('summon:p1');
  quota.acquire('subordinate:s1');
  quota.acquire('subordinate:s1');
}

/**
 * Standalone entity-cleanup fixture: registry + graph + ledger + service,
 * driven by explicit tick numbers. No kernel, no DOM, no timers — teardown
 * order is determined by call order and tick arguments alone, never by
 * render-frame coincidence.
 */
describe('lifecycle service standalone', () => {
  it('cascade-recycles subordinates before their owner, releasing each slot exactly once', () => {
    const ctx = setup(2);
    plantTree(ctx);

    ctx.lifecycle.finalizeRecycle('p1', { type: 'owner-left', ownerId: 'p1' }, 5);

    const recycledOrder = ctx.events
      .filter((e) => e.type === 'recycled')
      .map((e) => (e as { id: string }).id);
    expect(recycledOrder).toEqual(['b1', 'b2', 's1', 'p1']);

    // every slot returned exactly once — a second release would have thrown
    expect(ctx.quota.releases).toEqual(['subordinate:s1', 'subordinate:s1', 'summon:p1']);
    expect(ctx.quota.usage('summon:p1').used).toBe(0);
    expect(ctx.quota.usage('subordinate:s1').used).toBe(0);

    expect(ctx.registry.get('b1')!.recycleReason).toEqual({ type: 'owner-recycled', ownerId: 's1' });
    expect(ctx.registry.get('s1')!.recycleReason).toEqual({ type: 'owner-recycled', ownerId: 'p1' });
    expect(ctx.registry.get('p1')!.recycleReason).toEqual({ type: 'owner-left', ownerId: 'p1' });
    expect(ctx.registry.getLive('s1')).toBeUndefined();
  });

  it('force-finalizing an exiting entity releases its slot once; later finalizeExits is a no-op', () => {
    const ctx = setup(5);
    ctx.registry.add(record('s1', { quotaKey: 'summon:p1' }));
    ctx.quota.define('summon:p1', 1);
    ctx.quota.acquire('summon:p1');

    expect(ctx.lifecycle.beginExit('s1', { type: 'lifespan-expired' }, 1)).toEqual({ ok: true });
    ctx.lifecycle.finalizeRecycle('s1', { type: 'replaced', by: 's2' }, 2);
    expect(ctx.quota.releases).toEqual(['summon:p1']);

    // the grace finalization must not fire a second time
    ctx.lifecycle.finalizeExits(10);
    expect(ctx.quota.releases).toEqual(['summon:p1']);
    expect(ctx.events.filter((e) => e.type === 'recycled')).toHaveLength(1);
    expect(ctx.registry.get('s1')!.recycleReason).toEqual({ type: 'replaced', by: 's2' });
  });

  it('finalizes exits only when the explicit tick reaches the finalize tick', () => {
    const ctx = setup(2);
    ctx.registry.add(record('s1', { quotaKey: 'summon:p1' }));
    ctx.quota.define('summon:p1', 1);
    ctx.quota.acquire('summon:p1');

    ctx.lifecycle.beginExit('s1', { type: 'dismissed', by: 'p1' }, 1);
    ctx.lifecycle.finalizeExits(2); // finalize tick is 3: nothing happens
    expect(ctx.registry.getLive('s1')!.status).toBe('exiting');
    expect(ctx.quota.releases).toEqual([]);

    ctx.lifecycle.finalizeExits(3);
    expect(ctx.registry.get('s1')!.status).toBe('recycled');
    expect(ctx.registry.get('s1')!.recycleReason).toEqual({ type: 'dismissed', by: 'p1' });
    expect(ctx.quota.releases).toEqual(['summon:p1']);
  });

  it('ages lifespan per explicit tick and skips entities spawned on that tick', () => {
    const ctx = setup(0);
    ctx.registry.add(record('s1', { lifespanRemaining: 1, spawnedAtTick: 5 }));

    ctx.lifecycle.ageEntities(5); // same tick as spawn: not aged
    expect(ctx.registry.getLive('s1')!.lifespanRemaining).toBe(1);

    ctx.lifecycle.ageEntities(6); // lifespan hits 0: exit begins and (grace 0) finalizes
    expect(ctx.registry.get('s1')!.status).toBe('recycled');
    expect(ctx.registry.get('s1')!.recycleReason).toEqual({ type: 'lifespan-expired' });
    expect(ctx.events.map((e) => e.type)).toEqual(['exit-began', 'recycled']);
  });

  it('rejects exit requests for recycled or already-exiting entities', () => {
    const ctx = setup(1);
    ctx.registry.add(record('s1'));
    expect(ctx.lifecycle.beginExit('s1', { type: 'dismissed', by: 'p1' }, 0)).toEqual({ ok: true });
    const again = ctx.lifecycle.beginExit('s1', { type: 'dismissed', by: 'p1' }, 0);
    expect(again).toEqual({ ok: false, why: 'entity is already exiting' });

    ctx.lifecycle.finalizeExits(1);
    const afterDeath = ctx.lifecycle.beginExit('s1', { type: 'dismissed', by: 'p1' }, 1);
    expect(afterDeath).toEqual({ ok: false, why: 'entity is not live' });
  });
});
