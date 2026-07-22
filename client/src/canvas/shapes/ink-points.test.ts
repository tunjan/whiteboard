import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { DrawPoint } from '@whiteboard/shared';
import { ensurePointsArray, readPoints, syncYPoints } from './ink-points';

const stroke = (n: number): DrawPoint[] =>
  Array.from({ length: n }, (_, i) => ({ x: i, y: i * 2, pressure: 0.5 }));

/** A shape map in the current storage form: points in their own Y.Array. */
function modernShape(points: DrawPoint[]): Y.Map<unknown> {
  const doc = new Y.Doc();
  const m = new Y.Map<unknown>();
  doc.getMap('shapes').set('s', m);
  m.set('type', 'draw');
  m.set('props', { color: '#000000', size: 4, isClosed: false });
  m.set('points', Y.Array.from(points));
  return m;
}

/** A shape map as boards written before this change store it. */
function legacyShape(points: DrawPoint[]): Y.Map<unknown> {
  const doc = new Y.Doc();
  const m = new Y.Map<unknown>();
  doc.getMap('shapes').set('s', m);
  m.set('type', 'draw');
  m.set('props', { color: '#000000', size: 4, isClosed: false, points });
  return m;
}

describe('readPoints', () => {
  it('reads the Y.Array form', () => {
    const m = modernShape(stroke(5));
    expect(readPoints(m, m.get('props') as Record<string, unknown>)).toEqual(
      stroke(5),
    );
  });

  it('falls back to a legacy plain array inside props', () => {
    const m = legacyShape(stroke(5));
    expect(readPoints(m, m.get('props') as Record<string, unknown>)).toEqual(
      stroke(5),
    );
  });

  it('returns an empty array when points are missing entirely', () => {
    const m = legacyShape([]);
    m.set('props', { color: '#000000' });
    expect(readPoints(m, m.get('props') as Record<string, unknown>)).toEqual([]);
  });
});

describe('ensurePointsArray', () => {
  it('returns the existing array without rewriting it', () => {
    const m = modernShape(stroke(3));
    const before = m.get('points');
    expect(ensurePointsArray(m)).toBe(before);
  });

  it('promotes a legacy stroke, carrying its points over', () => {
    const m = legacyShape(stroke(4));
    const arr = ensurePointsArray(m);
    expect(arr).toBeInstanceOf(Y.Array);
    expect(arr.toArray()).toEqual(stroke(4));
  });

  it('promotes a legacy stroke that has no points', () => {
    const m = legacyShape([]);
    m.set('props', { color: '#000000' });
    expect(ensurePointsArray(m).toArray()).toEqual([]);
  });
});

describe('syncYPoints', () => {
  it('appends when the new points extend the old ones', () => {
    const m = modernShape(stroke(3));
    const arr = ensurePointsArray(m);
    let inserts = 0;
    let deletes = 0;
    arr.observe((e) => {
      for (const d of e.changes.delta) {
        if (d.insert) inserts++;
        if (d.delete) deletes++;
      }
    });

    syncYPoints(arr, stroke(6));

    expect(arr.toArray()).toEqual(stroke(6));
    // The point of the whole exercise: extending a stroke must not rewrite it.
    expect(deletes).toBe(0);
    expect(inserts).toBe(1);
  });

  it('replaces when the new points are shorter (commit-time simplification)', () => {
    const m = modernShape(stroke(10));
    const arr = ensurePointsArray(m);
    const simplified = stroke(10).filter((_, i) => i % 3 === 0);
    syncYPoints(arr, simplified);
    expect(arr.toArray()).toEqual(simplified);
  });

  it('replaces when an existing point changed, even at equal length', () => {
    // Guards the append fast path from silently ignoring an in-place edit.
    const m = modernShape(stroke(5));
    const arr = ensurePointsArray(m);
    const edited = stroke(5).map((p, i) => (i === 2 ? { ...p, x: 999 } : p));
    syncYPoints(arr, edited);
    expect(arr.toArray()).toEqual(edited);
  });

  it('replaces when a point changed and the array also grew', () => {
    const m = modernShape(stroke(5));
    const arr = ensurePointsArray(m);
    const edited = stroke(8).map((p, i) => (i === 1 ? { ...p, y: -1 } : p));
    syncYPoints(arr, edited);
    expect(arr.toArray()).toEqual(edited);
  });

  it('is a no-op when nothing changed', () => {
    const m = modernShape(stroke(4));
    const arr = ensurePointsArray(m);
    let events = 0;
    arr.observe(() => events++);
    syncYPoints(arr, stroke(4));
    expect(events).toBe(0);
    expect(arr.toArray()).toEqual(stroke(4));
  });

  it('handles growing from empty and clearing to empty', () => {
    const m = modernShape([]);
    const arr = ensurePointsArray(m);
    syncYPoints(arr, stroke(3));
    expect(arr.toArray()).toEqual(stroke(3));
    syncYPoints(arr, []);
    expect(arr.toArray()).toEqual([]);
  });

  it('distinguishes points that differ only by pressure', () => {
    const m = modernShape([{ x: 0, y: 0, pressure: 0.2 }]);
    const arr = ensurePointsArray(m);
    syncYPoints(arr, [{ x: 0, y: 0, pressure: 0.9 }]);
    expect(arr.toArray()).toEqual([{ x: 0, y: 0, pressure: 0.9 }]);
  });
});

describe('two-client stroke convergence', () => {
  it('merges appends from a drawer into a peer document', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    const shapeA = new Y.Map<unknown>();
    a.getMap('shapes').set('s', shapeA);
    shapeA.set('type', 'draw');
    shapeA.set('props', { color: '#000000', size: 4, isClosed: false });
    shapeA.set('points', Y.Array.from([] as DrawPoint[]));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    // The drawer appends frame by frame; the peer receives each update.
    const points: DrawPoint[] = [];
    for (const p of stroke(20)) {
      points.push(p);
      const before = Y.encodeStateVector(b);
      syncYPoints(ensurePointsArray(shapeA), [...points]);
      Y.applyUpdate(b, Y.encodeStateAsUpdate(a, before));
    }

    const shapeB = b.getMap('shapes').get('s') as Y.Map<unknown>;
    expect((shapeB.get('points') as Y.Array<DrawPoint>).toArray()).toEqual(
      stroke(20),
    );
  });
});
