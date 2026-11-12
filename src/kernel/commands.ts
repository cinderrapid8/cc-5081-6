import type { OwnershipGraph } from './ownership.js';
import type { EntityRecord, EntityRegistry } from './registry.js';
import type { Command, EntityId } from './types.js';

export type CommandCheck = { ok: true } | { ok: false; why: string };

/**
 * Command authority and target-selection rules.
 *
 * Authority: a commander must sit on the ownership chain of the target
 * (root player, intermediate summon, or the entity itself).
 *
 * Target selection: summons may attack any live hostile; subordinates are
 * restricted to whatever their direct owner is currently attacking.
 */
export class CommandRouter {
  constructor(
    private readonly registry: EntityRegistry,
    private readonly ownership: OwnershipGraph,
  ) {}

  canCommand(commanderId: EntityId, targetId: EntityId): boolean {
    return this.ownership.isAncestorOrSelf(commanderId, targetId);
  }

  checkTargetPermission(entity: EntityRecord, command: Command): CommandCheck {
    if (command.type === 'attack') {
      const target = this.registry.getLive(command.targetId);
      if (!target || target.kind !== 'hostile') {
        return { ok: false, why: 'attack target must be a live hostile' };
      }
      if (entity.kind === 'subordinate') {
        const owner = entity.ownerId ? this.registry.getLive(entity.ownerId) : undefined;
        if (!owner || owner.currentTargetId !== command.targetId) {
          return {
            ok: false,
            why: 'subordinate may only attack the current target of its owner',
          };
        }
      }
      return { ok: true };
    }
    if (command.type === 'follow') {
      const target = this.registry.getLive(command.targetId);
      if (!target || target.kind === 'hostile') {
        return { ok: false, why: 'follow target must be a live friendly entity' };
      }
      return { ok: true };
    }
    return { ok: true };
  }
}
