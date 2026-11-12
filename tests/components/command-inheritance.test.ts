import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  availabilityCommandState,
  spawnInheritance,
  transferredCommandState,
} from '../../src/kernel/command-inheritance.js';
import type { EntityRecord } from '../../src/kernel/registry.js';

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

/**
 * Standalone command-inheritance fixture: pure decisions over plain records.
 * No kernel, no tick loop, no render frames — dispatch order is the caller's
 * explicit call order.
 */
describe('command inheritance standalone', () => {
  it('spawn inherits stance, target and command authority from the owner', () => {
    const owner = record('p1', {
      kind: 'player',
      name: '阿凯',
      stance: 'aggressive',
      currentTargetId: 'boar',
    });
    const inheritance = spawnInheritance('s1', owner);
    expect(inheritance.stance).toBe('aggressive');
    expect(inheritance.currentTargetId).toBe('boar');
    expect(inheritance.commanderId).toBe('p1');
    expect(inheritance.commandSource).toEqual({ type: 'owner', why: 'takes orders from 阿凯' });
  });

  it('spawn from an unavailable player starts self-directed', () => {
    const owner = record('p1', { kind: 'player', name: '阿凯', available: false });
    const inheritance = spawnInheritance('s1', owner);
    expect(inheritance.commanderId).toBe('s1');
    expect(inheritance.commandSource.type).toBe('autonomous');
    expect(inheritance.commandSource.why).toContain('unavailable at spawn');
  });

  it('attack propagates the target to subordinates and clears follow orders', () => {
    const target = record('s1', { followTargetId: 'p1' });
    const children = [record('b1'), record('b2')];
    applyCommand(target, children, { type: 'attack', targetId: 'boar' });
    expect(target.currentTargetId).toBe('boar');
    expect(target.followTargetId).toBeNull();
    expect(children.map((c) => c.currentTargetId)).toEqual(['boar', 'boar']);
  });

  it('follow stays on the target; stance propagates to subordinates', () => {
    const target = record('s1', { currentTargetId: 'boar' });
    const children = [record('b1')];
    applyCommand(target, children, { type: 'follow', targetId: 'p1' });
    expect(target.followTargetId).toBe('p1');
    expect(target.currentTargetId).toBeNull();
    expect(children[0]!.followTargetId).toBeNull();

    applyCommand(target, children, { type: 'set-stance', stance: 'passive' });
    expect(target.stance).toBe('passive');
    expect(children[0]!.stance).toBe('passive');
  });

  it('availability toggles command authority without touching ownership', () => {
    const player = record('p1', { kind: 'player', name: '阿凯' });
    const summon = record('s1', { ownerId: 'p1' });
    const offline = availabilityCommandState(summon, player, player, false);
    expect(offline.commanderId).toBe('s1');
    expect(offline.commandSource.why).toContain('holding last orders');

    const online = availabilityCommandState(summon, player, player, true);
    expect(online.commanderId).toBe('p1');
    expect(online.commandSource).toEqual({ type: 'owner', why: 'takes orders from 阿凯' });
  });

  it('transfer moves command authority to the new owner', () => {
    const newOwner = record('p2', { kind: 'player', name: '贝蒂' });
    const state = transferredCommandState(newOwner);
    expect(state.commanderId).toBe('p2');
    expect(state.commandSource.why).toContain('ownership transferred');
  });
});
