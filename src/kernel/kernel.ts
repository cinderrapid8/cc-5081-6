import { EffectJournal, type EffectEntry } from './attribution.js';
import {
  applyCommand,
  availabilityCommandState,
  spawnInheritance,
  transferredCommandState,
} from './command-inheritance.js';
import { CommandRouter } from './commands.js';
import { IdGenerator } from './ids.js';
import { LifecycleService } from './lifecycle.js';
import { OwnershipGraph } from './ownership.js';
import {
  QuotaLedger,
  pickReplacementVictim,
  subordinatePoolKey,
  summonPoolKey,
} from './quota.js';
import { EntityRegistry, type EntityRecord } from './registry.js';
import type {
  Command,
  EntityId,
  KernelEvent,
  RecycleReason,
  Resolution,
  Result,
} from './types.js';

export interface KernelConfig {
  summonCap: number;
  subordinateCap: number;
  summonLifespan: number;
  subordinateLifespan: number;
  exitGraceTicks: number;
  maxOwnershipDepth: number;
}

export const DEFAULT_CONFIG: KernelConfig = {
  summonCap: 3,
  subordinateCap: 2,
  summonLifespan: 12,
  subordinateLifespan: 6,
  exitGraceTicks: 2,
  maxOwnershipDepth: 2,
};

export type FullPoolPolicy = 'replace-oldest' | 'reject';

interface QueuedRequest {
  requestId: string;
  kind: 'summon' | 'subordinate';
  ownerId: EntityId;
  name?: string;
  onFull: FullPoolPolicy;
  seq: number;
}

export interface EntityView {
  id: EntityId;
  kind: EntityRecord['kind'];
  name: string;
  ownerId: EntityId | null;
  ownerName: string | null;
  commanderId: EntityId | null;
  commanderName: string | null;
  commandWhy: string;
  stance: EntityRecord['stance'];
  currentTargetId: EntityId | null;
  lifespanRemaining: number | null;
  status: EntityRecord['status'];
  available: boolean;
  recycleReason: RecycleReason | null;
  spawnedAtTick: number;
  recycledAtTick: number | null;
}

export interface EffectExplanation {
  entry: EffectEntry;
  chain: Array<{
    id: EntityId;
    name: string;
    kind: EntityRecord['kind'];
    status: EntityRecord['status'];
    recycleReason: RecycleReason | null;
  }>;
  legalSourceId: EntityId;
  legalSourceName: string;
}

/**
 * Summon runtime kernel: composition root over four bounded components —
 * ownership traversal (OwnershipGraph), quota accounting (QuotaLedger),
 * command inheritance (command-inheritance.ts) and entity cleanup
 * (LifecycleService) — plus the identity registry, command router and effect
 * journal. Pure state machine: no timers, no DOM, no scene nodes. The
 * outside world drives it with requests and advanceTick(); views attach by
 * entity id and may be torn down freely without touching state.
 */
export class SummonKernel {
  readonly registry = new EntityRegistry();
  readonly ownership: OwnershipGraph;
  readonly quota = new QuotaLedger();
  readonly journal: EffectJournal;
  readonly lifecycle: LifecycleService;

  private readonly router: CommandRouter;
  private readonly ids = new IdGenerator();
  private readonly config: KernelConfig;
  private tickCount = 0;
  private readonly events: KernelEvent[] = [];
  private queue: QueuedRequest[] = [];
  private seq = 0;

  constructor(config: Partial<KernelConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.ownership = new OwnershipGraph(this.config.maxOwnershipDepth);
    this.journal = new EffectJournal(this.ids);
    this.router = new CommandRouter(this.registry, this.ownership);
    this.lifecycle = new LifecycleService({
      registry: this.registry,
      ownership: this.ownership,
      quota: this.quota,
      emit: (event) => this.emit(event),
      config: { exitGraceTicks: this.config.exitGraceTicks },
    });
  }

  get tick(): number {
    return this.tickCount;
  }

  getEvents(): readonly KernelEvent[] {
    return this.events;
  }

  private emit(event: KernelEvent): void {
    this.events.push(event);
  }

  nameOf(id: EntityId): string {
    return this.registry.get(id)?.name ?? id;
  }

  // ---------------------------------------------------------------- players

  registerPlayer(name: string): EntityId {
    const id = this.ids.next('player');
    this.registry.add(this.baseRecord(id, 'player', name));
    this.quota.define(summonPoolKey(id), this.config.summonCap);
    this.emit({ tick: this.tickCount, type: 'spawned', id, kind: 'player', name, ownerId: null });
    return id;
  }

  registerHostile(name: string): EntityId {
    const id = this.ids.next('hostile');
    this.registry.add(this.baseRecord(id, 'hostile', name));
    this.emit({ tick: this.tickCount, type: 'spawned', id, kind: 'hostile', name, ownerId: null });
    return id;
  }

  private baseRecord(id: EntityId, kind: EntityRecord['kind'], name: string): EntityRecord {
    return {
      id,
      kind,
      name,
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
      spawnedAtTick: this.tickCount,
      recycledAtTick: null,
    };
  }

  // --------------------------------------------------------------- requests

  requestSummon(ownerId: EntityId, opts: { name?: string; onFull?: FullPoolPolicy } = {}): string {
    return this.enqueue('summon', ownerId, opts);
  }

  requestSubordinate(
    ownerId: EntityId,
    opts: { name?: string; onFull?: FullPoolPolicy } = {},
  ): string {
    return this.enqueue('subordinate', ownerId, opts);
  }

  private enqueue(
    kind: QueuedRequest['kind'],
    ownerId: EntityId,
    opts: { name?: string; onFull?: FullPoolPolicy },
  ): string {
    const requestId = this.ids.next('req');
    this.queue.push({
      requestId,
      kind,
      ownerId,
      name: opts.name,
      onFull: opts.onFull ?? 'replace-oldest',
      seq: this.seq++,
    });
    return requestId;
  }

  // ------------------------------------------------------------------- tick

  advanceTick(): KernelEvent[] {
    this.tickCount += 1;
    const from = this.events.length;
    this.drainRequests();
    this.lifecycle.ageEntities(this.tickCount);
    this.lifecycle.finalizeExits(this.tickCount);
    return this.events.slice(from);
  }

  private drainRequests(): void {
    const batch = [...this.queue].sort((a, b) => a.seq - b.seq);
    this.queue = [];
    for (const request of batch) this.processRequest(request);
  }

  private processRequest(request: QueuedRequest): void {
    const owner = this.registry.getLive(request.ownerId);
    const reject = (why: string) =>
      this.emit({ tick: this.tickCount, type: 'request-rejected', requestId: request.requestId, why });

    if (!owner || owner.status !== 'active') return reject('owner is not active');
    if (request.kind === 'summon') {
      if (owner.kind !== 'player') return reject('summons must belong to a player');
      if (!owner.available) return reject('owner is currently unavailable');
    } else {
      if (owner.kind !== 'summon') return reject('subordinates must belong to a summon');
    }

    const poolKey =
      request.kind === 'summon' ? summonPoolKey(owner.id) : subordinatePoolKey(owner.id);
    if (request.kind === 'subordinate') {
      this.quota.define(poolKey, this.config.subordinateCap);
    }

    let id: EntityId | null = null;
    if (this.quota.acquire(poolKey)) {
      id = this.ids.next(request.kind);
    } else if (request.onFull === 'replace-oldest') {
      const victimId = pickReplacementVictim(
        this.registry.allLive().filter((e) => e.quotaKey === poolKey),
      );
      if (victimId) {
        id = this.ids.next(request.kind);
        this.lifecycle.finalizeRecycle(victimId, { type: 'replaced', by: id }, this.tickCount);
        this.quota.acquire(poolKey);
      }
    }
    if (!id) return reject(`quota full: ${poolKey}`);

    this.spawnCompanion(id, request.kind, owner, request.name, poolKey);
    this.emit({ tick: this.tickCount, type: 'request-accepted', requestId: request.requestId, entityId: id });
  }

  private spawnCompanion(
    id: EntityId,
    kind: 'summon' | 'subordinate',
    owner: EntityRecord,
    name: string | undefined,
    poolKey: string,
  ): void {
    const record = this.baseRecord(id, kind, name ?? `${kind} ${id}`);
    record.ownerId = owner.id;
    record.lifespanRemaining =
      kind === 'summon' ? this.config.summonLifespan : this.config.subordinateLifespan;
    record.quotaKey = poolKey;
    const inheritance = spawnInheritance(id, owner);
    record.stance = inheritance.stance;
    record.currentTargetId = inheritance.currentTargetId;
    record.commanderId = inheritance.commanderId;
    record.commandSource = inheritance.commandSource;
    this.registry.add(record);
    this.ownership.attach(id, owner.id);
    this.emit({
      tick: this.tickCount,
      type: 'spawned',
      id,
      kind,
      name: record.name,
      ownerId: owner.id,
    });
    this.emitQuota(poolKey);
  }

  // --------------------------------------------------------------- lifecycle

  /** Exit entry point: delegates to the lifecycle service at the current tick. */
  beginExit(id: EntityId, reason: RecycleReason): Result {
    return this.lifecycle.beginExit(id, reason, this.tickCount);
  }

  dismiss(id: EntityId, byId: EntityId): Result {
    const record = this.registry.getLive(id);
    if (!record) return { ok: false, why: 'entity is not live' };
    if (!this.router.canCommand(byId, id)) {
      return { ok: false, why: `${byId} has no command authority over ${id}` };
    }
    return this.lifecycle.beginExit(id, { type: 'dismissed', by: byId }, this.tickCount);
  }

  /** Terminal teardown callback: delegates to the lifecycle service. */
  finalizeRecycle(id: EntityId, reason: RecycleReason): void {
    this.lifecycle.finalizeRecycle(id, reason, this.tickCount);
  }

  // -------------------------------------------------------------- ownership

  /**
   * Ownership change without destruction: identity, effects history and
   * subordinate links survive; the quota slot moves to the new owner's pool
   * atomically (acquire-first, so a full target pool rejects cleanly).
   */
  transferOwnership(entityId: EntityId, newOwnerId: EntityId): Result {
    const record = this.registry.getLive(entityId);
    if (!record || record.status !== 'active') return { ok: false, why: 'entity is not active' };
    if (record.kind !== 'summon' && record.kind !== 'subordinate') {
      return { ok: false, why: 'only companions can change ownership' };
    }
    const newOwner = this.registry.getLive(newOwnerId);
    if (!newOwner || newOwner.status !== 'active') {
      return { ok: false, why: 'new owner is not active' };
    }
    if (record.kind === 'summon' && newOwner.kind !== 'player') {
      return { ok: false, why: 'a summon must be owned by a player' };
    }
    if (record.kind === 'subordinate' && newOwner.kind !== 'summon') {
      return { ok: false, why: 'a subordinate must be owned by a summon' };
    }
    const attachCheck = this.ownership.canAttach(entityId, newOwnerId);
    if (!attachCheck.ok) return attachCheck;

    const newKey =
      record.kind === 'summon'
        ? summonPoolKey(this.ownership.rootOf(newOwnerId))
        : subordinatePoolKey(newOwnerId);
    if (record.kind === 'subordinate') this.quota.define(newKey, this.config.subordinateCap);
    if (!this.quota.acquire(newKey)) {
      return { ok: false, why: `quota full: ${newKey}` };
    }

    const fromOwnerId = record.ownerId;
    if (record.quotaKey) {
      this.quota.release(record.quotaKey);
      this.emitQuota(record.quotaKey);
    }
    this.ownership.attach(entityId, newOwnerId);
    record.ownerId = newOwnerId;
    record.quotaKey = newKey;
    const commandState = transferredCommandState(newOwner);
    record.commanderId = commandState.commanderId;
    record.commandSource = commandState.commandSource;
    this.emitQuota(newKey);
    this.emit({
      tick: this.tickCount,
      type: 'ownership-transferred',
      id: entityId,
      fromOwnerId: fromOwnerId ?? entityId,
      toOwnerId: newOwnerId,
    });
    return { ok: true };
  }

  // ----------------------------------------------------------- availability

  /**
   * Temporary unavailability (disconnect, stun, cutscene): command authority
   * falls back to autonomous mode, but ownership, quota and attribution are
   * untouched — nothing is recycled and nothing is released.
   */
  setPlayerAvailability(playerId: EntityId, available: boolean): Result {
    const player = this.registry.getLive(playerId);
    if (!player || player.kind !== 'player') return { ok: false, why: 'not a player' };
    player.available = available;
    this.emit({ tick: this.tickCount, type: 'availability-changed', id: playerId, available });
    for (const record of this.registry.allLive()) {
      if (record.kind !== 'summon' && record.kind !== 'subordinate') continue;
      if (record.status !== 'active') continue;
      if (this.ownership.rootOf(record.id) !== playerId) continue;
      const owner = this.registry.mustGet(record.ownerId!);
      const state = availabilityCommandState(record, player, owner, available);
      record.commanderId = state.commanderId;
      record.commandSource = state.commandSource;
      this.emit({
        tick: this.tickCount,
        type: 'command-source-changed',
        id: record.id,
        source: record.commandSource,
      });
    }
    return { ok: true };
  }

  /** Permanent departure: everything owned is cascade-recycled. */
  removePlayer(playerId: EntityId): Result {
    const player = this.registry.getLive(playerId);
    if (!player || player.kind !== 'player') return { ok: false, why: 'not a player' };
    this.finalizeRecycle(playerId, { type: 'owner-left', ownerId: playerId });
    return { ok: true };
  }

  // --------------------------------------------------------------- commands

  issueCommand(commanderId: EntityId, targetId: EntityId, command: Command): Result {
    const commander = this.registry.getLive(commanderId);
    const target = this.registry.getLive(targetId);
    const reject = (why: string): Result => {
      this.emit({ tick: this.tickCount, type: 'command-rejected', commanderId, targetId, why });
      return { ok: false, why };
    };
    if (!commander || commander.status !== 'active') return reject('commander is not active');
    if (!target || target.status !== 'active') return reject('target is not active');
    if (target.kind === 'hostile') return reject('hostiles cannot receive commands');
    if (!this.router.canCommand(commanderId, targetId)) {
      return reject('commander is not in the ownership chain of the target');
    }
    const permission = this.router.checkTargetPermission(target, command);
    if (!permission.ok) return reject(permission.why);

    const children = this.ownership
      .childrenOf(targetId)
      .map((childId) => this.registry.getLive(childId))
      .filter((child): child is EntityRecord => !!child && child.status === 'active');
    applyCommand(target, children, command);
    this.emit({ tick: this.tickCount, type: 'command-issued', commanderId, targetId, command });
    return { ok: true };
  }

  // -------------------------------------------------------------- attribution

  recordEffect(sourceId: EntityId, kind: string, detail: string, targetId?: EntityId): EffectEntry {
    const source = this.registry.getLive(sourceId);
    if (!source || source.status !== 'active') {
      throw new Error(`effect source is not active: ${sourceId}`);
    }
    const chain = this.ownership.chainToRoot(sourceId);
    const entry = this.journal.record(
      this.tickCount,
      sourceId,
      chain,
      kind,
      detail,
      targetId ?? null,
    );
    this.emit({
      tick: this.tickCount,
      type: 'effect-recorded',
      effectId: entry.effectId,
      sourceId,
      rootId: chain[chain.length - 1]!,
    });
    return entry;
  }

  /**
   * Resolves an effect's legal source even after every party was recycled.
   * Explicit failure contract: unknown effects and chains referencing
   * entities outside the current scene fail with a reason — the legal source
   * is never defaulted to a placeholder or the local player.
   */
  explainEffect(effectId: string): Resolution<EffectExplanation> {
    const entry = this.journal.get(effectId);
    if (!entry) return { ok: false, why: `unknown effect: ${effectId}` };
    const chain: EffectExplanation['chain'] = [];
    for (const id of entry.chain) {
      const record = this.registry.get(id);
      if (!record) {
        return { ok: false, why: `ownership chain broken: ${id} is not in the current scene` };
      }
      chain.push({
        id,
        name: record.name,
        kind: record.kind,
        status: record.status,
        recycleReason: record.recycleReason,
      });
    }
    const legal = chain[chain.length - 1]!;
    return { ok: true, value: { entry, chain, legalSourceId: legal.id, legalSourceName: legal.name } };
  }

  // ------------------------------------------------------------------ views

  entityView(id: EntityId): EntityView | null {
    const record = this.registry.get(id);
    if (!record) return null;
    const owner = record.ownerId ? this.registry.get(record.ownerId) : undefined;
    const commander = record.commanderId ? this.registry.get(record.commanderId) : undefined;
    return {
      id: record.id,
      kind: record.kind,
      name: record.name,
      ownerId: record.ownerId,
      ownerName: owner?.name ?? null,
      commanderId: record.commanderId,
      commanderName: commander?.name ?? null,
      commandWhy: record.commandSource.why,
      stance: record.stance,
      currentTargetId: record.currentTargetId,
      lifespanRemaining: record.lifespanRemaining,
      status: record.status,
      available: record.available,
      recycleReason: record.recycleReason,
      spawnedAtTick: record.spawnedAtTick,
      recycledAtTick: record.recycledAtTick,
    };
  }

  listViews(): EntityView[] {
    return this.registry
      .all()
      .map((r) => this.entityView(r.id)!)
      .sort((a, b) => a.spawnedAtTick - b.spawnedAtTick || a.id.localeCompare(b.id));
  }

  private emitQuota(key: string): void {
    const usage = this.quota.usage(key);
    this.emit({
      tick: this.tickCount,
      type: 'quota-changed',
      key,
      used: usage.used,
      cap: usage.cap,
    });
  }
}
