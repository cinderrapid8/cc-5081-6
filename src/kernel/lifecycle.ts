import type { OwnershipGraph } from './ownership.js';
import type { QuotaLedger } from './quota.js';
import type { EntityRegistry } from './registry.js';
import type { EntityId, KernelEvent, RecycleReason, Result } from './types.js';

export interface LifecycleConfig {
  exitGraceTicks: number;
}

export interface LifecycleDeps {
  registry: EntityRegistry;
  ownership: OwnershipGraph;
  quota: QuotaLedger;
  emit: (event: KernelEvent) => void;
  config: LifecycleConfig;
}

/**
 * Entity cleanup: lifespan aging, exit grace and terminal recycling. Driven
 * by explicit tick numbers — no timers, no render frames — so teardown order
 * is deterministic: subordinates are cascade-recycled before their owner,
 * and each quota slot is released exactly once, when the record leaves the
 * live registry.
 */
export class LifecycleService {
  constructor(private readonly deps: LifecycleDeps) {}

  beginExit(id: EntityId, reason: RecycleReason, tick: number): Result {
    const { registry, config } = this.deps;
    const record = registry.getLive(id);
    if (!record || record.status === 'recycled') return { ok: false, why: 'entity is not live' };
    if (record.status === 'exiting') return { ok: false, why: 'entity is already exiting' };
    record.status = 'exiting';
    record.pendingRecycleReason = reason;
    record.exitFinalizeTick = tick + config.exitGraceTicks;
    this.deps.emit({
      tick,
      type: 'exit-began',
      id,
      finalizeTick: record.exitFinalizeTick,
      reason,
    });
    if (config.exitGraceTicks === 0) {
      this.finalizeRecycle(id, reason, tick);
    }
    return { ok: true };
  }

  ageEntities(tick: number): void {
    for (const record of this.deps.registry.allLive()) {
      if (record.status !== 'active' || record.lifespanRemaining === null) continue;
      if (record.spawnedAtTick === tick) continue;
      record.lifespanRemaining -= 1;
      if (record.lifespanRemaining <= 0) {
        this.beginExit(record.id, { type: 'lifespan-expired' }, tick);
      }
    }
  }

  finalizeExits(tick: number): void {
    for (const record of this.deps.registry.allLive()) {
      if (
        record.status === 'exiting' &&
        record.exitFinalizeTick !== null &&
        record.exitFinalizeTick <= tick
      ) {
        this.finalizeRecycle(
          record.id,
          record.pendingRecycleReason ?? { type: 'lifespan-expired' },
          tick,
        );
      }
    }
  }

  /**
   * Terminal teardown. Distinct from ownership transfer: the record moves to
   * the tombstone registry, its quota slot is released, and subordinates are
   * cascade-recycled first. Identity stays resolvable for attribution.
   */
  finalizeRecycle(id: EntityId, reason: RecycleReason, tick: number): void {
    const { registry, ownership, quota } = this.deps;
    const record = registry.getLive(id);
    if (!record) return;
    for (const child of ownership.childrenOf(id)) {
      this.finalizeRecycle(child, { type: 'owner-recycled', ownerId: id }, tick);
    }
    ownership.detach(id);
    record.status = 'recycled';
    record.recycleReason = reason;
    record.recycledAtTick = tick;
    record.pendingRecycleReason = null;
    record.exitFinalizeTick = null;
    record.lifespanRemaining = null;
    record.commanderId = null;
    record.commandSource = { type: 'autonomous', why: 'recycled — no commander' };
    if (record.quotaKey) {
      quota.release(record.quotaKey);
      this.emitQuota(record.quotaKey, tick);
    }
    registry.retire(id);
    this.deps.emit({ tick, type: 'recycled', id, reason });
  }

  private emitQuota(key: string, tick: number): void {
    const usage = this.deps.quota.usage(key);
    this.deps.emit({ tick, type: 'quota-changed', key, used: usage.used, cap: usage.cap });
  }
}
