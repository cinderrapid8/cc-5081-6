export type EntityId = string;

/** Command-style outcome: nothing to return on success. */
export type Result = { ok: true } | { ok: false; why: string };

/**
 * Query-style outcome: an explicit value on success, an explicit failure
 * otherwise. Lookups must never silently substitute a default (such as the
 * local player) when the requested entity is not in the current scene.
 */
export type Resolution<T> = { ok: true; value: T } | { ok: false; why: string };

export type EntityKind = 'player' | 'summon' | 'subordinate' | 'hostile';

export type EntityStatus = 'active' | 'exiting' | 'recycled';

export type Stance = 'aggressive' | 'defensive' | 'passive';

export type RecycleReason =
  | { type: 'lifespan-expired' }
  | { type: 'dismissed'; by: EntityId }
  | { type: 'replaced'; by: EntityId }
  | { type: 'owner-recycled'; ownerId: EntityId }
  | { type: 'owner-left'; ownerId: EntityId };

export interface CommandSource {
  type: 'self' | 'owner' | 'autonomous';
  why: string;
}

export type Command =
  | { type: 'attack'; targetId: EntityId }
  | { type: 'follow'; targetId: EntityId }
  | { type: 'set-stance'; stance: Stance };

export type KernelEvent =
  | { tick: number; type: 'spawned'; id: EntityId; kind: EntityKind; name: string; ownerId: EntityId | null }
  | { tick: number; type: 'exit-began'; id: EntityId; finalizeTick: number; reason: RecycleReason }
  | { tick: number; type: 'recycled'; id: EntityId; reason: RecycleReason }
  | { tick: number; type: 'request-accepted'; requestId: string; entityId: EntityId }
  | { tick: number; type: 'request-rejected'; requestId: string; why: string }
  | { tick: number; type: 'command-issued'; commanderId: EntityId; targetId: EntityId; command: Command }
  | { tick: number; type: 'command-rejected'; commanderId: EntityId; targetId: EntityId; why: string }
  | { tick: number; type: 'command-source-changed'; id: EntityId; source: CommandSource }
  | { tick: number; type: 'ownership-transferred'; id: EntityId; fromOwnerId: EntityId; toOwnerId: EntityId }
  | { tick: number; type: 'availability-changed'; id: EntityId; available: boolean }
  | { tick: number; type: 'effect-recorded'; effectId: string; sourceId: EntityId; rootId: EntityId }
  | { tick: number; type: 'quota-changed'; key: string; used: number; cap: number };

export function recycleReasonText(reason: RecycleReason | null, nameOf: (id: EntityId) => string): string {
  if (!reason) return '—';
  switch (reason.type) {
    case 'lifespan-expired':
      return '寿命到期';
    case 'dismissed':
      return `被 ${nameOf(reason.by)} 手动遣散`;
    case 'replaced':
      return `被新对象 ${nameOf(reason.by)} 替换`;
    case 'owner-recycled':
      return `归属对象 ${nameOf(reason.ownerId)} 被回收，连带回收`;
    case 'owner-left':
      return `召唤者 ${nameOf(reason.ownerId)} 永久离场`;
  }
}
