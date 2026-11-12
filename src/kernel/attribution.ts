import { IdGenerator } from './ids.js';
import type { EntityId } from './types.js';

export interface EffectEntry {
  effectId: string;
  tick: number;
  sourceId: EntityId;
  /** Ownership chain snapshot at record time: source first, root owner last. */
  chain: EntityId[];
  kind: string;
  detail: string;
  targetId: EntityId | null;
}

/**
 * Append-only effect journal. Each entry freezes the attribution chain when
 * the effect happens, so later recycling or ownership transfers never rewrite
 * the legal source of a past effect.
 */
export class EffectJournal {
  private entries = new Map<string, EffectEntry>();

  constructor(private readonly ids: IdGenerator) {}

  record(
    tick: number,
    sourceId: EntityId,
    chain: EntityId[],
    kind: string,
    detail: string,
    targetId: EntityId | null,
  ): EffectEntry {
    const entry: EffectEntry = {
      effectId: this.ids.next('fx'),
      tick,
      sourceId,
      chain: [...chain],
      kind,
      detail,
      targetId,
    };
    this.entries.set(entry.effectId, entry);
    return entry;
  }

  get(effectId: string): EffectEntry | undefined {
    return this.entries.get(effectId);
  }

  list(): EffectEntry[] {
    return [...this.entries.values()];
  }
}
