import type { EntityId, Resolution } from './types.js';

export class OwnershipError extends Error {}

export type AttachCheck = { ok: true } | { ok: false; why: string };

/**
 * Ownership forest: player (depth 0) -> summon (depth 1) -> subordinate (depth 2).
 * Every query walks with a visited set, so lookups terminate even if data were
 * corrupted; attach() refuses cycles and depth overflow up front, keeping the
 * graph a forest by construction.
 */
export class OwnershipGraph {
  private parent = new Map<EntityId, EntityId>();
  private children = new Map<EntityId, Set<EntityId>>();

  constructor(private readonly maxDepth: number) {}

  parentOf(id: EntityId): EntityId | null {
    return this.parent.get(id) ?? null;
  }

  childrenOf(id: EntityId): EntityId[] {
    return [...(this.children.get(id) ?? [])];
  }

  /** Path from id up to the root, id first. Terminates via visited set. */
  chainToRoot(id: EntityId): EntityId[] {
    const resolved = this.resolveChain(id);
    if (!resolved.ok) throw new OwnershipError(resolved.why);
    return resolved.value;
  }

  /**
   * Non-throwing chain query for boundary callers: a corrupted graph yields
   * an explicit failure instead of an exception. Note the graph only knows
   * edges — an id with no parent resolves to itself, so "is this entity in
   * the current scene at all" must be answered by the registry, not here.
   */
  resolveChain(id: EntityId): Resolution<EntityId[]> {
    const chain: EntityId[] = [];
    const seen = new Set<EntityId>();
    let current: EntityId | undefined = id;
    while (current !== undefined) {
      if (seen.has(current)) {
        return { ok: false, why: `ownership cycle detected at ${current}` };
      }
      seen.add(current);
      chain.push(current);
      current = this.parent.get(current);
    }
    return { ok: true, value: chain };
  }

  rootOf(id: EntityId): EntityId {
    const chain = this.chainToRoot(id);
    return chain[chain.length - 1]!;
  }

  resolveRoot(id: EntityId): Resolution<EntityId> {
    const chain = this.resolveChain(id);
    if (!chain.ok) return chain;
    return { ok: true, value: chain.value[chain.value.length - 1]! };
  }

  isAncestorOrSelf(ancestor: EntityId, id: EntityId): boolean {
    return this.chainToRoot(id).includes(ancestor);
  }

  private heightOf(id: EntityId): number {
    const kids = this.childrenOf(id);
    if (kids.length === 0) return 0;
    return 1 + Math.max(...kids.map((k) => this.heightOf(k)));
  }

  canAttach(child: EntityId, parent: EntityId): AttachCheck {
    if (child === parent) return { ok: false, why: 'an entity cannot own itself' };
    if (this.isAncestorOrSelf(child, parent)) {
      return { ok: false, why: `cycle rejected: ${child} is an ancestor of ${parent}` };
    }
    const parentDepth = this.chainToRoot(parent).length - 1;
    const resultingDepth = parentDepth + 1 + this.heightOf(child);
    if (resultingDepth > this.maxDepth) {
      return {
        ok: false,
        why: `depth rejected: attaching ${child} under ${parent} would reach depth ${resultingDepth} (max ${this.maxDepth})`,
      };
    }
    return { ok: true };
  }

  attach(child: EntityId, parent: EntityId): void {
    const check = this.canAttach(child, parent);
    if (!check.ok) throw new OwnershipError(check.why);
    this.detach(child);
    this.parent.set(child, parent);
    let set = this.children.get(parent);
    if (!set) {
      set = new Set();
      this.children.set(parent, set);
    }
    set.add(child);
  }

  detach(child: EntityId): void {
    const p = this.parent.get(child);
    if (p === undefined) return;
    this.children.get(p)?.delete(child);
    this.parent.delete(child);
  }
}
