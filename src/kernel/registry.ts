import type {
  CommandSource,
  EntityId,
  EntityKind,
  EntityStatus,
  RecycleReason,
  Stance,
} from './types.js';

export interface EntityRecord {
  id: EntityId;
  kind: EntityKind;
  name: string;
  ownerId: EntityId | null;
  commanderId: EntityId | null;
  commandSource: CommandSource;
  stance: Stance;
  currentTargetId: EntityId | null;
  followTargetId: EntityId | null;
  lifespanRemaining: number | null;
  status: EntityStatus;
  available: boolean;
  recycleReason: RecycleReason | null;
  pendingRecycleReason: RecycleReason | null;
  exitFinalizeTick: number | null;
  quotaKey: string | null;
  spawnedAtTick: number;
  recycledAtTick: number | null;
}

/**
 * Identity registry. Entities are first-class records keyed by stable id.
 * Recycling moves a record to the tombstone map instead of dropping it, so
 * effect attribution and audit queries keep resolving after destruction.
 * The kernel never references view/scene nodes; views bind by entity id.
 */
export class EntityRegistry {
  private live = new Map<EntityId, EntityRecord>();
  private tombstones = new Map<EntityId, EntityRecord>();

  add(record: EntityRecord): void {
    this.live.set(record.id, record);
  }

  get(id: EntityId): EntityRecord | undefined {
    return this.live.get(id) ?? this.tombstones.get(id);
  }

  getLive(id: EntityId): EntityRecord | undefined {
    return this.live.get(id);
  }

  mustGet(id: EntityId): EntityRecord {
    const record = this.get(id);
    if (!record) throw new Error(`unknown entity: ${id}`);
    return record;
  }

  retire(id: EntityId): void {
    const record = this.live.get(id);
    if (!record) return;
    this.live.delete(id);
    this.tombstones.set(id, record);
  }

  allLive(): EntityRecord[] {
    return [...this.live.values()];
  }

  all(): EntityRecord[] {
    return [...this.live.values(), ...this.tombstones.values()];
  }

  allTombstones(): EntityRecord[] {
    return [...this.tombstones.values()];
  }
}
