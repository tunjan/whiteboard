import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { DrawPoint } from '@whiteboard/shared';
import {
  compactYPoints,
  encodePointsForStorage,
  ensurePointsArray,
  readPoints,
  syncYPoints,
} from './ink-points';

const stroke = (n: number): DrawPoint[] =>
  Array.from({ length: n }, (_, i) => ({ x: i, y: i * 2, pressure: 0.5 }));

/**
 * A stroke shaped like one a hand draws: curved, fractionally spaced, and
 * passing near both axes, where a coordinate is small while the step that
 * reached it is not.
 */
const curvedStroke = (n: number): DrawPoint[] =>
  Array.from({ length: n }, (_, i) => {
    const angle = i * 0.05;
    const radius = 200 + i * 2.5;
    return {
      x: Math.cos(angle) * radius - 200,
      y: Math.sin(angle) * radius,
      pressure: 0.5,
    };
  });

/** A shape map holding its points as encoded chunks. */
function modernShape(points: DrawPoint[]): Y.Map<unknown> {
  const doc = new Y.Doc();
  const m = new Y.Map<unknown>();
  doc.getMap('shapes').set('s', m);
  m.set('type', 'draw');
  m.set('props', { color: '#000000', size: 4, isClosed: false });
  m.set('points', Y.Array.from(encodePointsForStorage(points)));
  return m;
}

describe('encodePointsForStorage', () => {
  it('encodes a stroke as one chunk, and nothing as nothing', () => {
    const encoded = encodePointsForStorage(stroke(4));
    expect(encoded).toHaveLength(1);
    expect(encoded[0]).toBeInstanceOf(Uint8Array);
    expect(encodePointsForStorage([])).toEqual([]);
  });
});

describe('readPoints', () => {
  it('returns an empty array when the shape has no points array', () => {
    const m = modernShape([]);
    m.delete('points');
    expect(readPoints(m)).toEqual([]);
  });

  it('ignores entries that are not chunks', () => {
    const m = modernShape(stroke(3));
    (m.get('points') as Y.Array<unknown>).push(['2:AAAA', { x: 1, y: 1 }, 7]);
    expect(readPoints(m)).toEqual(stroke(3));
  });
});

describe('ensurePointsArray', () => {
  it('returns the existing array without rewriting it', () => {
    const m = modernShape(stroke(3));
    const before = m.get('points');
    expect(ensurePointsArray(m)).toBe(before);
  });

  it('creates an empty array for a shape without one', () => {
    const m = modernShape([]);
    m.delete('points');
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

    expect(arr).toHaveLength(2);
    expect(readPoints(m)).toEqual(stroke(6));
    // The point of the whole exercise: extending a stroke must not rewrite it.
    expect(deletes).toBe(0);
    expect(inserts).toBe(1);
  });

  it('keeps appending across a whole curved stroke', () => {
    // The straight integer fixture above sits on the storage grid, so it
    // cannot see the append path fall over. A real stroke is fractional: the
    // stored value differs from the sample it was written from by the
    // quantization, and comparing the two decides `append` vs `rewrite` for
    // every frame of every stroke.
    const m = modernShape([]);
    const arr = ensurePointsArray(m);
    const drawn = curvedStroke(600);
    let deletes = 0;
    arr.observe((e) => {
      for (const d of e.changes.delta) if (d.delete) deletes++;
    });

    // Two samples a frame, the rate the draw tool flushes at.
    for (let n = 2; n <= drawn.length; n += 2) {
      arr.doc!.transact(() => syncYPoints(arr, drawn.slice(0, n)));
    }

    expect(deletes).toBe(0);
    expect(arr).toHaveLength(drawn.length / 2);
    expect(readPoints(m)).toHaveLength(drawn.length);
  });

  it('keeps appending when the shape was created holding its seed point', () => {
    // How the draw tool actually starts a stroke: `createShape` writes the
    // press sample, so the mirror is first built over a chunk it did not see
    // written, and the first append compares against decoded values.
    const drawn = curvedStroke(600);
    const m = modernShape(drawn.slice(0, 1));
    const arr = ensurePointsArray(m);
    let deletes = 0;
    arr.observe((e) => {
      for (const d of e.changes.delta) if (d.delete) deletes++;
    });

    for (let n = 2; n <= drawn.length; n += 2) {
      arr.doc!.transact(() => syncYPoints(arr, drawn.slice(0, n)));
    }

    expect(deletes).toBe(0);
    expect(readPoints(m)).toHaveLength(drawn.length);
  });

  it('replaces when the new points are shorter', () => {
    const m = modernShape(stroke(10));
    const arr = ensurePointsArray(m);
    const shorter = stroke(10).filter((_, i) => i % 3 === 0);
    syncYPoints(arr, shorter);
    expect(arr.toArray()).toEqual(encodePointsForStorage(shorter));
  });

  it('replaces when an existing point changed, even at equal length', () => {
    // Guards the append fast path from silently ignoring an in-place edit.
    const m = modernShape(stroke(5));
    const arr = ensurePointsArray(m);
    const edited = stroke(5).map((p, i) => (i === 2 ? { ...p, x: 999 } : p));
    syncYPoints(arr, edited);
    expect(arr.toArray()).toEqual(encodePointsForStorage(edited));
  });

  it('replaces when a point changed and the array also grew', () => {
    const m = modernShape(stroke(5));
    const arr = ensurePointsArray(m);
    const edited = stroke(8).map((p, i) => (i === 1 ? { ...p, y: -1 } : p));
    syncYPoints(arr, edited);
    expect(arr.toArray()).toEqual(encodePointsForStorage(edited));
  });

  it('is a no-op when nothing changed', () => {
    const m = modernShape(stroke(4));
    const arr = ensurePointsArray(m);
    let events = 0;
    arr.observe(() => events++);
    syncYPoints(arr, stroke(4));
    expect(events).toBe(0);
    expect(arr.toArray()).toEqual(encodePointsForStorage(stroke(4)));
  });

  it('handles growing from empty and clearing to empty', () => {
    const m = modernShape([]);
    const arr = ensurePointsArray(m);
    syncYPoints(arr, stroke(3));
    expect(arr.toArray()).toEqual(encodePointsForStorage(stroke(3)));
    syncYPoints(arr, []);
    expect(arr.toArray()).toEqual([]);
  });

  it('distinguishes points that differ only by pressure', () => {
    const m = modernShape([{ x: 0, y: 0, pressure: 0.25 }]);
    const arr = ensurePointsArray(m);
    syncYPoints(arr, [{ x: 0, y: 0, pressure: 0.75 }]);
    expect(readPoints(m)).toEqual([{ x: 0, y: 0, pressure: 0.75 }]);
  });
});

describe('incremental point mirror', () => {

  it('tracks appends made by a peer, not just local writes', () => {
    const m = modernShape(stroke(3));
    const arr = ensurePointsArray(m);
    expect(readPoints(m)).toEqual(stroke(3)); // seeds the mirror
    arr.push(encodePointsForStorage(stroke(5).slice(3)));
    expect(readPoints(m)).toEqual(stroke(5));
  });

  it('tracks a same-length rewrite, which no length check would catch', () => {
    const m = modernShape(stroke(4));
    const arr = ensurePointsArray(m);
    expect(readPoints(m)).toEqual(stroke(4));
    const moved = stroke(4).map((p) => ({ ...p, x: p.x + 100 }));
    arr.doc!.transact(() => {
      arr.delete(0, arr.length);
      arr.insert(0, encodePointsForStorage(moved));
    });
    expect(readPoints(m)).toEqual(moved);
  });

  it('reads correctly from inside the transaction that is writing', () => {
    const m = modernShape(stroke(3));
    const arr = ensurePointsArray(m);
    expect(readPoints(m)).toEqual(stroke(3));
    let seen: DrawPoint[] = [];
    arr.doc!.transact(() => {
      syncYPoints(arr, stroke(7));
      // The array observer hasn't fired yet — the mirror is a write behind.
      seen = readPoints(m);
    });
    expect(seen).toEqual(stroke(7));
    expect(readPoints(m)).toEqual(stroke(7));
  });

  it('handles two writes to one array inside a single transaction', () => {
    const m = modernShape(stroke(3));
    const arr = ensurePointsArray(m);
    expect(readPoints(m)).toEqual(stroke(3));
    arr.doc!.transact(() => {
      syncYPoints(arr, stroke(5));
      syncYPoints(arr, stroke(9));
    });
    expect(arr).toHaveLength(3);
    expect(readPoints(m)).toEqual(stroke(9));
  });

  // Something that is not a chunk — a peer on an older build, say — can land
  // in an array this client has already mirrored. The mirror steps aside, and
  // the next write normalizes the array rather than appending onto it.
  it('steps aside for a non-chunk insert, then normalizes on write', () => {
    const m = modernShape(stroke(2));
    const arr = ensurePointsArray(m) as Y.Array<unknown>;
    expect(readPoints(m)).toEqual(stroke(2));

    arr.push([{ x: 9, y: 9, pressure: 0.3 }]);
    expect(readPoints(m)).toEqual(stroke(2));

    syncYPoints(ensurePointsArray(m), stroke(5));
    expect(arr.toArray()).toEqual(encodePointsForStorage(stroke(5)));
    expect(readPoints(m)).toEqual(stroke(5));
  });

  // The point of the mirror: a frame of a live stroke must cost its new points,
  // not the whole stroke. Decoded objects for untouched indices are reused, so
  // identity is what shows the decode did not run over the array again.
  it('decodes only the appended points when a stroke grows', () => {
    const m = modernShape(stroke(3));
    const arr = ensurePointsArray(m);
    const before = readPoints(m).slice();

    arr.doc!.transact(() => syncYPoints(arr, stroke(50)));
    const after = readPoints(m);

    expect(after).toEqual(stroke(50));
    for (let i = 0; i < before.length; i++) expect(after[i]).toBe(before[i]);
  });

  // The quadratic this replaced was mostly garbage: every frame of a live
  // stroke decoded the whole array again, so drawing n points allocated
  // n(n+1)/2 point objects and threw all but the last n away — 180,300 of them
  // for a stroke at the 600-point cap, mid-gesture, on the tightest frame
  // budget in the app. Counting distinct objects pins that down without timing.
  it('allocates one object per point over a whole stroke, not one per frame', () => {
    const n = 200;
    const m = modernShape([]);
    const arr = ensurePointsArray(m);
    const seen = new Set<DrawPoint>();
    const drawn: DrawPoint[] = [];

    for (let i = 0; i < n; i++) {
      drawn.push({ x: i, y: i * 2, pressure: 0.5 });
      arr.doc!.transact(() => syncYPoints(arr, drawn.slice()));
      for (const p of readPoints(m)) seen.add(p);
    }

    expect(readPoints(m)).toEqual(drawn);
    expect(seen.size).toBe(n); // was n * (n + 1) / 2
  });

  it('follows an undo back to the shorter stroke', () => {
    const m = modernShape(stroke(3));
    const arr = ensurePointsArray(m);
    const undo = new Y.UndoManager(arr);
    expect(readPoints(m)).toEqual(stroke(3));
    arr.doc!.transact(() => syncYPoints(arr, stroke(8)));
    expect(readPoints(m)).toEqual(stroke(8));
    undo.undo();
    expect(readPoints(m)).toEqual(stroke(3));
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
    shapeA.set('points', Y.Array.from([] as number[]));
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
    expect(readPoints(shapeB)).toEqual(stroke(20));
  });
});

describe('compactYPoints', () => {
  /**
   * Draw `points` frame by frame, `perFrame` samples at a time, each frame in
   * its own transaction as `updateShape` writes it.
   */
  function drawLive(
    m: Y.Map<unknown>,
    points: DrawPoint[],
    perFrame: number,
    afterFrame?: () => void,
  ): ReturnType<typeof ensurePointsArray> {
    const arr = ensurePointsArray(m);
    for (let end = perFrame; end < points.length; end += perFrame) {
      m.doc!.transact(() => syncYPoints(arr, points.slice(0, end)));
      afterFrame?.();
    }
    return arr;
  }

  const pressured = (n: number): DrawPoint[] =>
    curvedStroke(n).map((p, i) => ({
      ...p,
      pressure: 0.3 + 0.4 * Math.abs(Math.sin(i * 0.07)),
    }));

  function expectClose(actual: DrawPoint[], expected: DrawPoint[]): void {
    expect(actual).toHaveLength(expected.length);
    for (let i = 0; i < expected.length; i++) {
      expect(Math.abs(actual[i]!.x - expected[i]!.x)).toBeLessThan(0.02);
      expect(Math.abs(actual[i]!.y - expected[i]!.y)).toBeLessThan(0.02);
      expect(
        Math.abs(actual[i]!.pressure! - expected[i]!.pressure!),
      ).toBeLessThan(0.01);
    }
  }

  it('merges per-frame chunks into one segment in the final write', () => {
    const points = pressured(300);
    const m = modernShape(points.slice(0, 1));
    const arr = drawLive(m, points, 2);
    const doc = m.doc!;
    const live = Y.encodeStateAsUpdateV2(doc).length;
    expect(arr.length).toBeGreaterThan(100);

    doc.transact(() => {
      syncYPoints(arr, points);
      compactYPoints(arr, points);
    });

    expect(arr.length).toBe(1);
    expectClose(readPoints(m), points);
    // Each frame's chunk carries a header, a first point stored against zero
    // and a Y.Array item; the tombstone the delete leaves is far smaller.
    expect(Y.encodeStateAsUpdateV2(doc).length).toBeLessThan(live * 0.8);
  });

  it('reaches a peer that was following the live stroke', () => {
    const points = pressured(90);
    const m = modernShape(points.slice(0, 1));
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(m.doc!));
    const peerShape = peer.getMap('shapes').get('s') as Y.Map<unknown>;
    let sent = Y.encodeStateVector(peer);
    const arr = drawLive(m, points, 2, () => {
      Y.applyUpdate(peer, Y.encodeStateAsUpdate(m.doc!, sent));
      sent = Y.encodeStateVector(peer);
      readPoints(peerShape);
    });
    const before = Y.encodeStateVector(peer);
    m.doc!.transact(() => {
      syncYPoints(arr, points);
      compactYPoints(arr, points);
    });
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(m.doc!, before));

    expect((peerShape.get('points') as Y.Array<unknown>).length).toBe(1);
    expectClose(readPoints(peerShape), points);
  });

  it('leaves a stroke that is already compact untouched', () => {
    const points = pressured(50);
    const m = modernShape(points);
    const arr = ensurePointsArray(m);
    const before = Y.encodeStateVector(m.doc!);
    compactYPoints(arr, points);
    expect(Y.encodeStateAsUpdate(m.doc!, before).length).toBeLessThan(3);
  });
});
