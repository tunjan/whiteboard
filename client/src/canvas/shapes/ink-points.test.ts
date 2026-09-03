import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { DrawPoint } from '@whiteboard/shared';
import {
  encodeLegacyPointTriples,
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

/** A shape map in the current storage form: Base64 vector segments. */
function modernShape(points: DrawPoint[]): Y.Map<unknown> {
  const doc = new Y.Doc();
  const m = new Y.Map<unknown>();
  doc.getMap('shapes').set('s', m);
  m.set('type', 'draw');
  m.set('props', { color: '#000000', size: 4, isClosed: false });
  m.set('points', Y.Array.from(encodePointsForStorage(points)));
  return m;
}

/** A shape map from the flat-number-triple storage era. */
function triplesEraShape(points: DrawPoint[]): Y.Map<unknown> {
  const doc = new Y.Doc();
  const m = new Y.Map<unknown>();
  doc.getMap('shapes').set('s', m);
  m.set('type', 'draw');
  m.set('props', { color: '#000000', size: 4, isClosed: false });
  m.set('points', Y.Array.from(encodeLegacyPointTriples(points)));
  return m;
}

/** A shape map from the object-array era: DrawPoint objects in a Y.Array. */
function objectEraShape(points: DrawPoint[]): Y.Map<unknown> {
  const doc = new Y.Doc();
  const m = new Y.Map<unknown>();
  doc.getMap('shapes').set('s', m);
  m.set('type', 'draw');
  m.set('props', { color: '#000000', size: 4, isClosed: false });
  m.set('points', Y.Array.from(points));
  return m;
}

/** A shape map as boards written before points left `props` store it. */
function legacyShape(points: DrawPoint[]): Y.Map<unknown> {
  const doc = new Y.Doc();
  const m = new Y.Map<unknown>();
  doc.getMap('shapes').set('s', m);
  m.set('type', 'draw');
  m.set('props', { color: '#000000', size: 4, isClosed: false, points });
  return m;
}

describe('encodePointsForStorage', () => {
  it('encodes one pressure-bearing Base64 vector segment', () => {
    const encoded = encodePointsForStorage([
      { x: 1, y: 2, pressure: 0.7 },
      { x: 3, y: 4, pressure: 0.2 },
    ]);
    expect(encoded).toHaveLength(1);
    expect(encoded[0]).toMatch(/^3:/);
  });

  it('uses compact 2D storage when pressure is neutral or omitted', () => {
    expect(encodePointsForStorage([{ x: 5, y: 6 }])[0]).toMatch(/^2:/);
  });

  it('starts a new Float32 anchor when a delta exceeds Float16 range', () => {
    const points = [
      { x: 0, y: 0, pressure: 0.5 },
      { x: 10, y: 20, pressure: 0.5 },
      { x: 100_000, y: -100_000, pressure: 0.5 },
      { x: 100_010, y: -99_980, pressure: 0.5 },
    ];
    const m = modernShape(points);

    expect(ensurePointsArray(m)).toHaveLength(2);
    expect(readPoints(m, m.get('props') as Record<string, unknown>)).toEqual(
      points,
    );
  });
});

describe('readPoints', () => {
  it('reads the number-triple form', () => {
    const m = triplesEraShape(stroke(5));
    expect(readPoints(m, m.get('props') as Record<string, unknown>)).toEqual(
      stroke(5),
    );
  });

  it('reads the object-array era form', () => {
    const m = objectEraShape(stroke(5));
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
    expect(readPoints(m, m.get('props') as Record<string, unknown>)).toEqual(
      [],
    );
  });
});

describe('ensurePointsArray', () => {
  it('returns the existing array without rewriting it', () => {
    const m = modernShape(stroke(3));
    const before = m.get('points');
    expect(ensurePointsArray(m)).toBe(before);
  });

  it('returns an object-era array as-is, deferring migration to the write', () => {
    const m = objectEraShape(stroke(3));
    const before = m.get('points');
    expect(ensurePointsArray(m)).toBe(before);
  });

  it('promotes a legacy stroke to Base64 segments, carrying its points over', () => {
    const m = legacyShape(stroke(4));
    const arr = ensurePointsArray(m);
    expect(arr).toBeInstanceOf(Y.Array);
    expect(arr.toArray()).toEqual(encodePointsForStorage(stroke(4)));
    expect(readPoints(m, m.get('props') as Record<string, unknown>)).toEqual(
      stroke(4),
    );
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

    expect(arr).toHaveLength(2);
    expect(readPoints(m, m.get('props') as Record<string, unknown>)).toEqual(
      stroke(6),
    );
    // The point of the whole exercise: extending a stroke must not rewrite it.
    expect(deletes).toBe(0);
    expect(inserts).toBe(1);
  });

  it('keeps appending across a whole curved stroke', () => {
    // The straight integer fixture above round-trips through the Float16 delta
    // encoding exactly, so it cannot see the append path fall over. A real
    // stroke is curved, fractional, and crosses the axes: there the stored
    // value differs from the sample it was written from by the quantization of
    // its own step, which has nothing to do with the coordinate's magnitude.
    // Comparing the two decides `append` vs `rewrite` for every frame of every
    // stroke, so getting it wrong costs the whole point of the Y.Array.
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
    expect(readPoints(m, {})).toHaveLength(drawn.length);
  });

  it('keeps appending when the shape was created holding its seed point', () => {
    // How the draw tool actually starts a stroke: `createShape` writes the
    // press sample, so the mirror is first built over a chunk it did not see
    // written. Adopting the shadow only when the array was empty meant a live
    // stroke never had one, and the lossy comparison above eventually failed
    // mid-stroke and rewrote the array.
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
    expect(readPoints(m, {})).toHaveLength(drawn.length);
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
    const m = modernShape([{ x: 0, y: 0, pressure: 0.2 }]);
    const arr = ensurePointsArray(m);
    syncYPoints(arr, [{ x: 0, y: 0, pressure: 0.9 }]);
    expect(readPoints(m, m.get('props') as Record<string, unknown>)).toEqual([
      { x: 0, y: 0, pressure: 0.9 },
    ]);
  });

  it('migrates an object-era array to Base64 on first write', () => {
    const m = objectEraShape(stroke(4));
    const arr = ensurePointsArray(m);
    const edited = stroke(4).map((p, i) => (i === 0 ? { ...p, x: -5 } : p));
    syncYPoints(arr, edited);
    expect(arr.toArray()).toEqual(encodePointsForStorage(edited));
    expect(readPoints(m, m.get('props') as Record<string, unknown>)).toEqual(
      edited,
    );
  });
});

describe('incremental point mirror', () => {
  const props = (m: Y.Map<unknown>) =>
    m.get('props') as Record<string, unknown>;

  it('tracks appends made by a peer, not just local writes', () => {
    const m = modernShape(stroke(3));
    const arr = ensurePointsArray(m);
    expect(readPoints(m, props(m))).toEqual(stroke(3)); // seeds the mirror
    arr.push(encodePointsForStorage(stroke(5).slice(3)));
    expect(readPoints(m, props(m))).toEqual(stroke(5));
  });

  it('tracks a same-length rewrite, which no length check would catch', () => {
    const m = modernShape(stroke(4));
    const arr = ensurePointsArray(m);
    expect(readPoints(m, props(m))).toEqual(stroke(4));
    const moved = stroke(4).map((p) => ({ ...p, x: p.x + 100 }));
    arr.doc!.transact(() => {
      arr.delete(0, arr.length);
      arr.insert(0, encodePointsForStorage(moved));
    });
    expect(readPoints(m, props(m))).toEqual(moved);
  });

  it('tracks an edit in the middle of the array', () => {
    const m = triplesEraShape(stroke(6));
    const arr = ensurePointsArray(m);
    expect(readPoints(m, props(m))).toEqual(stroke(6));
    arr.doc!.transact(() => {
      arr.delete(6, 3); // point 2
      arr.insert(6, [-1, -2, 0.25]);
    });
    const edited = stroke(6);
    edited[2] = { x: -1, y: -2, pressure: 0.25 };
    expect(readPoints(m, props(m))).toEqual(edited);
  });

  it('tracks a deletion from the middle of the array', () => {
    const m = triplesEraShape(stroke(6));
    const arr = ensurePointsArray(m);
    expect(readPoints(m, props(m))).toEqual(stroke(6));
    arr.doc!.transact(() => arr.delete(3, 6)); // points 1 and 2
    expect(readPoints(m, props(m))).toEqual(
      stroke(6).filter((_, i) => i !== 1 && i !== 2),
    );
  });

  it('reads correctly from inside the transaction that is writing', () => {
    const m = modernShape(stroke(3));
    const arr = ensurePointsArray(m);
    expect(readPoints(m, props(m))).toEqual(stroke(3));
    let seen: DrawPoint[] = [];
    arr.doc!.transact(() => {
      syncYPoints(arr, stroke(7));
      // The array observer hasn't fired yet — the mirror is a write behind.
      seen = readPoints(m, props(m));
    });
    expect(seen).toEqual(stroke(7));
    expect(readPoints(m, props(m))).toEqual(stroke(7));
  });

  it('handles two writes to one array inside a single transaction', () => {
    const m = modernShape(stroke(3));
    const arr = ensurePointsArray(m);
    expect(readPoints(m, props(m))).toEqual(stroke(3));
    arr.doc!.transact(() => {
      syncYPoints(arr, stroke(5));
      syncYPoints(arr, stroke(9));
    });
    expect(arr).toHaveLength(3);
    expect(readPoints(m, props(m))).toEqual(stroke(9));
  });

  // A peer on the object-era build can still insert point objects into an
  // array this client has already mirrored. The mirror can't represent those,
  // so it steps aside: the triples still read back, and the next write
  // normalizes the array rather than appending onto mixed contents.
  it('steps aside for an object insert from a peer on an older build', () => {
    const m = modernShape(stroke(2));
    const arr = ensurePointsArray(m) as Y.Array<unknown>;
    expect(readPoints(m, props(m))).toEqual(stroke(2));

    arr.push([{ x: 9, y: 9, pressure: 0.3 }]);
    expect(readPoints(m, props(m))).toEqual(stroke(2));

    syncYPoints(ensurePointsArray(m), stroke(5));
    expect(arr.toArray()).toEqual(encodePointsForStorage(stroke(5)));
    expect(readPoints(m, props(m))).toEqual(stroke(5));
  });

  // The point of the mirror: a frame of a live stroke must cost its new points,
  // not the whole stroke. Decoded objects for untouched indices are reused, so
  // identity is what shows the decode did not run over the array again.
  it('decodes only the appended points when a stroke grows', () => {
    const m = modernShape(stroke(3));
    const arr = ensurePointsArray(m);
    const before = readPoints(m, props(m)).slice();

    arr.doc!.transact(() => syncYPoints(arr, stroke(50)));
    const after = readPoints(m, props(m));

    expect(after).toEqual(stroke(50));
    for (let i = 0; i < before.length; i++) expect(after[i]).toBe(before[i]);
  });

  it('re-decodes from the first point an edit touched, and no earlier', () => {
    const m = triplesEraShape(stroke(10));
    const arr = ensurePointsArray(m);
    const before = readPoints(m, props(m)).slice();

    arr.doc!.transact(() => {
      arr.delete(21, 3); // point 7
      arr.insert(21, [-1, -2, 0.25]);
    });
    const after = readPoints(m, props(m));

    for (let i = 0; i < 7; i++) expect(after[i]).toBe(before[i]);
    expect(after[7]).toEqual({ x: -1, y: -2, pressure: 0.25 });
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
      for (const p of readPoints(m, props(m))) seen.add(p);
    }

    expect(readPoints(m, props(m))).toEqual(drawn);
    expect(seen.size).toBe(n); // was n * (n + 1) / 2
  });

  it('follows an undo back to the shorter stroke', () => {
    const m = modernShape(stroke(3));
    const arr = ensurePointsArray(m);
    const undo = new Y.UndoManager(arr);
    expect(readPoints(m, props(m))).toEqual(stroke(3));
    arr.doc!.transact(() => syncYPoints(arr, stroke(8)));
    expect(readPoints(m, props(m))).toEqual(stroke(8));
    undo.undo();
    expect(readPoints(m, props(m))).toEqual(stroke(3));
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
    expect(
      readPoints(shapeB, shapeB.get('props') as Record<string, unknown>),
    ).toEqual(stroke(20));
  });
});
