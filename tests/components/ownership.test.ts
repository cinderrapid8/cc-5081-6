import { describe, expect, it } from 'vitest';
import { OwnershipError, OwnershipGraph } from '../../src/kernel/ownership.js';

/**
 * Standalone ownership-traversal fixture. The graph only knows edges: an id
 * with no parent resolves to itself, so "is the owner in the current scene"
 * is explicitly the registry's question, never inferred from liveness here.
 */
describe('ownership graph standalone', () => {
  it('resolves chains and roots with explicit results', () => {
    const graph = new OwnershipGraph(2);
    graph.attach('s1', 'p1');
    graph.attach('b1', 's1');

    expect(graph.resolveChain('b1')).toEqual({ ok: true, value: ['b1', 's1', 'p1'] });
    expect(graph.resolveRoot('b1')).toEqual({ ok: true, value: 'p1' });
    expect(graph.chainToRoot('b1')).toEqual(['b1', 's1', 'p1']);
  });

  it('resolves an unattached id to itself without inventing an owner', () => {
    const graph = new OwnershipGraph(2);
    // 'ghost' is not in any scene; the graph must not attribute it anywhere
    expect(graph.resolveRoot('ghost')).toEqual({ ok: true, value: 'ghost' });
    expect(graph.resolveChain('ghost')).toEqual({ ok: true, value: ['ghost'] });
  });

  it('re-parenting moves the whole subtree and stale parents are forgotten', () => {
    const graph = new OwnershipGraph(3);
    graph.attach('s1', 'p1');
    graph.attach('b1', 's1');
    graph.attach('s1', 'p2');
    expect(graph.resolveChain('b1')).toEqual({ ok: true, value: ['b1', 's1', 'p2'] });
    expect(graph.childrenOf('p1')).toEqual([]);
  });

  it('refuses cycles, self-ownership and depth overflow at attach time', () => {
    const graph = new OwnershipGraph(2);
    graph.attach('s1', 'p1');
    graph.attach('b1', 's1');
    expect(graph.canAttach('p1', 'b1').ok).toBe(false);
    expect(graph.canAttach('s1', 's1').ok).toBe(false);
    expect(graph.canAttach('x', 'b1').ok).toBe(false);
    expect(() => graph.attach('p1', 'b1')).toThrow(OwnershipError);
    // rejected attaches leave the forest untouched
    expect(graph.resolveChain('b1')).toEqual({ ok: true, value: ['b1', 's1', 'p1'] });
  });
});
