import { describe, expect, it } from 'vitest';
import { generateNKeysBetween } from 'fractional-indexing';
import * as Y from 'yjs';
import type { Shape } from '@whiteboard/shared';
import { getBottomIndex, getTopIndex, jitterKeyBetween } from './order';
import { compareIndex } from './use-document-store';

const shape = (id: string, index: string): Shape =>
  ({ id, type: 'rectangle', x: 0, y: 0, rotation: 0, index, props: {} }) as unknown as Shape;

describe('jitterKeyBetween', () => {
  it('always lands strictly between its bounds', () => {
    const keys = generateNKeysBetween(null, null, 40);
    for (let i = 0; i < keys.length - 1; i++) {
      const a = keys[i]!;
      const b = keys[i + 1]!;
      for (let t = 0; t < 25; t++) {
        const mid = jitterKeyBetween(a, b);
        expect(a < mid).toBe(true);
        expect(mid < b).toBe(true);
      }
    }
  });

  it('respects open bounds on either side', () => {
    for (let t = 0; t < 200; t++) {
      expect(jitterKeyBetween('a0', null) > 'a0').toBe(true);
      expect(jitterKeyBetween(null, 'a0') < 'a0').toBe(true);
      expect(typeof jitterKeyBetween(null, null)).toBe('string');
    }
  });

  it('does not repeat itself for the same bounds', () => {
    // The whole point: two clients inserting at the same position must not
    // compute the same key. Plain generateKeyBetween would yield 1 distinct key.
    //
    // Bound: 1000 draws from 2^16 buckets collide ~n²/2^17 ≈ 7.6 times by the
    // birthday bound, so ~992 distinct is the *expected* result — do not tighten
    // this past ~990 or it will flake.
    const keys = new Set<string>();
    for (let t = 0; t < 1000; t++) keys.add(jitterKeyBetween('a0', 'a1'));
    expect(keys.size).toBeGreaterThan(975);
  });
});

describe('getTopIndex / getBottomIndex', () => {
  const shapes = [shape('a', 'a0'), shape('b', 'a1'), shape('c', 'a2')];

  it('places a key above / below every existing shape', () => {
    for (let t = 0; t < 200; t++) {
      expect(getTopIndex(shapes) > 'a2').toBe(true);
      expect(getBottomIndex(shapes) < 'a0').toBe(true);
    }
  });

  it('handles an empty document', () => {
    expect(typeof getTopIndex([])).toBe('string');
    expect(typeof getBottomIndex([])).toBe('string');
  });

  it('gives concurrent creators distinct keys', () => {
    // Two clients each draw a shape "on top" of identical state. Before
    // jittering these were byte-identical, which left z-order unresolvable.
    // See the birthday-bound note above for why the threshold is not ~1000.
    const keys = new Set<string>();
    for (let t = 0; t < 1000; t++) keys.add(getTopIndex(shapes));
    expect(keys.size).toBeGreaterThan(975);
  });
});

describe('two-client z-order convergence', () => {
  /**
   * Models one client the way the document store does: a Y.Doc plus a
   * `shapeCache`-shaped Map whose *insertion order* is the order events arrived
   * on that client. That ordering is the divergence vector — a locally drawn
   * shape enters the cache before the peer's, and vice versa on the other side.
   */
  function makeClient(name: string) {
    const doc = new Y.Doc();
    const shapes = doc.getMap<Y.Map<unknown>>('shapes');
    const cache = new Map<string, Shape>();
    const sync = () => {
      // Mirror `applyAffected`: only ids not already cached get appended, so the
      // cache keeps each client's own arrival order.
      for (const [id, m] of shapes) {
        if (!cache.has(id)) cache.set(id, shape(id, m.get('index') as string));
      }
    };
    return {
      name,
      doc,
      draw() {
        sync();
        const index = getTopIndex([...cache.values()]);
        const id = `${name}-${cache.size}`;
        doc.transact(() => {
          const m = new Y.Map<unknown>();
          m.set('index', index);
          shapes.set(id, m);
        });
        sync();
      },
      order() {
        sync();
        return [...cache.values()].sort(compareIndex).map((s) => s.id);
      },
    };
  }

  it('converges when both clients draw on top of identical state', () => {
    for (let trial = 0; trial < 50; trial++) {
      const a = makeClient('a');
      const b = makeClient('b');
      const seed = Y.encodeStateAsUpdate(a.doc);
      Y.applyUpdate(b.doc, seed);

      // Both draw "on top" without having seen each other's shape.
      a.draw();
      b.draw();

      // Now they sync both ways.
      const fromA = Y.encodeStateAsUpdate(a.doc);
      const fromB = Y.encodeStateAsUpdate(b.doc);
      Y.applyUpdate(b.doc, fromA);
      Y.applyUpdate(a.doc, fromB);

      expect(a.order()).toEqual(b.order());
    }
  });
});

describe('compareIndex', () => {
  it('orders by index', () => {
    expect(compareIndex(shape('a', 'a0'), shape('b', 'a1'))).toBeLessThan(0);
    expect(compareIndex(shape('a', 'a1'), shape('b', 'a0'))).toBeGreaterThan(0);
  });

  it('breaks ties on id so equal indices still order deterministically', () => {
    const x = shape('x', 'a0');
    const y = shape('y', 'a0');
    expect(compareIndex(x, y)).toBeLessThan(0);
    expect(compareIndex(y, x)).toBeGreaterThan(0);
    expect(compareIndex(x, x)).toBe(0);
  });

  it('sorts a colliding pair the same way regardless of input order', () => {
    // The divergence this guards against: `sort` is stable, so without the
    // tiebreaker the result would follow insertion order, which differs per client.
    const x = shape('x', 'a0');
    const y = shape('y', 'a0');
    expect([x, y].sort(compareIndex).map((s) => s.id)).toEqual(['x', 'y']);
    expect([y, x].sort(compareIndex).map((s) => s.id)).toEqual(['x', 'y']);
  });
});
