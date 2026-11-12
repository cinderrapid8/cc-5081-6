import type { EntityRecord } from './registry.js';
import type { Command, CommandSource, EntityId, Stance } from './types.js';

export interface SpawnInheritance {
  stance: Stance;
  currentTargetId: EntityId | null;
  commanderId: EntityId;
  commandSource: CommandSource;
}

export interface CommandState {
  commanderId: EntityId;
  commandSource: CommandSource;
}

/**
 * Command inheritance at spawn time: stance and current target copy from the
 * owner; command authority attaches to the owner, unless the owner is an
 * unavailable player, in which case the companion starts self-directed.
 */
export function spawnInheritance(id: EntityId, owner: EntityRecord): SpawnInheritance {
  if (owner.kind === 'player' && !owner.available) {
    return {
      stance: owner.stance,
      currentTargetId: owner.currentTargetId,
      commanderId: id,
      commandSource: {
        type: 'autonomous',
        why: `owner ${owner.name} unavailable at spawn — self-directed`,
      },
    };
  }
  return {
    stance: owner.stance,
    currentTargetId: owner.currentTargetId,
    commanderId: owner.id,
    commandSource: { type: 'owner', why: `takes orders from ${owner.name}` },
  };
}

/**
 * Applies an accepted command to the target and propagates it to the
 * target's subordinates: attack targets and stances inherit downward,
 * follow orders stay on the target. Callers pass the live, active child
 * records in ownership order.
 */
export function applyCommand(
  target: EntityRecord,
  children: readonly EntityRecord[],
  command: Command,
): void {
  if (command.type === 'attack') {
    target.currentTargetId = command.targetId;
    target.followTargetId = null;
    for (const child of children) child.currentTargetId = command.targetId;
  } else if (command.type === 'follow') {
    target.followTargetId = command.targetId;
    target.currentTargetId = null;
  } else {
    target.stance = command.stance;
    for (const child of children) child.stance = command.stance;
  }
}

/**
 * Command source while the root player is temporarily unavailable: companions
 * hold their last orders self-directed; on reconnect, authority returns to
 * the direct owner. Ownership and quota are deliberately untouched.
 */
export function availabilityCommandState(
  record: EntityRecord,
  rootPlayer: EntityRecord,
  directOwner: EntityRecord,
  available: boolean,
): CommandState {
  if (!available) {
    return {
      commanderId: record.id,
      commandSource: {
        type: 'autonomous',
        why: `owner ${rootPlayer.name} unavailable — holding last orders`,
      },
    };
  }
  return {
    commanderId: directOwner.id,
    commandSource: { type: 'owner', why: `takes orders from ${directOwner.name}` },
  };
}

/** Command source after an ownership transfer: authority moves to the new owner. */
export function transferredCommandState(newOwner: EntityRecord): CommandState {
  return {
    commanderId: newOwner.id,
    commandSource: {
      type: 'owner',
      why: `takes orders from ${newOwner.name} (ownership transferred)`,
    },
  };
}
