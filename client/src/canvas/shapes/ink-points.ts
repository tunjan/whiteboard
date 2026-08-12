import * as Y from 'yjs';
import type { DrawPoint } from '@whiteboard/shared';

/**
 * Yjs encoding for a draw shape's point array.
 *
 * Ink points are a growing sequence, for the same reason text is one. A stroke
 * is rewritten once per frame while it is being drawn; held inside the shape's
 * `props` object each write re-encoded the whole array, so an n-point stroke
 * cost O(n²) document bytes — paid by every peer and retained forever. Stored as
 * a Y.Array the live path appends only the new points, making a stroke O(n).
 *
 * Points are stored as flat number triples `[x0, y0, p0, x1, y1, p1, …]`
 * rather than `{x, y, pressure}` objects: Yjs encodes a bare number in a
 * fraction of the bytes of a keyed map entry (measured ~12.6KB → ~8KB per
 * 300-point stroke), and rendering is byte-identical because the decode
 * restores the exact same values.
 */

/** Storage element type: number triples now, objects for older strokes. */
type StoredPoint = number | DrawPoint;

const NEUTRAL_PRESSURE = 0.5;

function encodeTriples(points: DrawPoint[]): number[] {
  const out = new Array<number>(points.length * 3);
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    out[i * 3] = p.x;
    out[i * 3 + 1] = p.y;
    out[i * 3 + 2] = p.pressure ?? NEUTRAL_PRESSURE;
  }
  return out;
}

function decodeTriples(values: number[]): DrawPoint[] {
  const count = Math.floor(values.length / 3);
  const out = new Array<DrawPoint>(count);
  for (let i = 0; i < count; i++) {
    out[i] = {
      x: values[i * 3]!,
      y: values[i * 3 + 1]!,
      pressure: values[i * 3 + 2]!,
    };
  }
  return out;
}

/**
 * Materialize a draw shape's points, accepting any storage form.
 *
 * Three generations coexist: number-triple Y.Arrays (current), object
 * Y.Arrays (the first Y.Array form), and plain arrays inside `props` (before
 * points moved out of props). Old forms are read in place and only converted
 * when edited — the same read-both, write-new arrangement used for text
 * shapes vs Y.Text.
 */
export function readPoints(
  m: Y.Map<unknown>,
  storedProps: Record<string, unknown>,
): DrawPoint[] {
  const arr = m.get('points');
  if (arr instanceof Y.Array) {
    const raw = (arr as Y.Array<StoredPoint>).toArray();
    if (raw.length === 0) return [];
    return typeof raw[0] === 'number'
      ? decodeTriples(raw as number[])
      : (raw as DrawPoint[]);
  }
  return Array.isArray(storedProps.points)
    ? (storedProps.points as DrawPoint[])
    : [];
}

/**
 * Write `next` into a points Y.Array, appending when possible.
 *
 * The live stroke only ever grows, so it takes the append branch and each frame
 * costs just the new points. The replace branch covers wholesale edits (resize,
 * partial erase) and the one-time migration of an object-era array to triples;
 * those run once per gesture, not once per frame.
 */
export function syncYPoints(
  arr: Y.Array<StoredPoint>,
  next: DrawPoint[],
): void {
  // One `toArray` then a plain-array scan. Indexing a Y.Array is O(log n) per
  // access, so comparing through `arr.get(i)` would cost O(n log n) per frame —
  // worse than the whole-array write this replaces. Materializing once is O(n),
  // the same cost the caller already pays to build `next`.
  const current = arr.toArray();
  if (current.length > 0 && typeof current[0] !== 'number') {
    // Object-era array being edited: rewrite it as triples in one shot.
    arr.delete(0, current.length);
    arr.insert(0, encodeTriples(next));
    return;
  }
  const currentNums = current as number[];
  const nextNums = encodeTriples(next);
  if (nextNums.length >= currentNums.length) {
    let isAppend = true;
    for (let i = 0; i < currentNums.length; i++) {
      if (currentNums[i] !== nextNums[i]) {
        isAppend = false;
        break;
      }
    }
    if (isAppend) {
      if (nextNums.length > currentNums.length) {
        arr.push(nextNums.slice(currentNums.length));
      }
      return;
    }
  }
  arr.delete(0, currentNums.length);
  arr.insert(0, nextNums);
}

/**
 * The Y.Array holding a shape's points, converting a legacy props-array
 * stroke on first write. Seeded as triples so no points are lost; an existing
 * Y.Array (either era) is returned as-is — syncYPoints migrates object-era
 * contents when it writes.
 */
export function ensurePointsArray(m: Y.Map<unknown>): Y.Array<StoredPoint> {
  const existing = m.get('points');
  if (existing instanceof Y.Array) return existing as Y.Array<StoredPoint>;
  const legacy = m.get('props') as { points?: unknown } | undefined;
  const arr = Y.Array.from(
    encodeTriples(
      Array.isArray(legacy?.points) ? (legacy.points as DrawPoint[]) : [],
    ) as StoredPoint[],
  );
  m.set('points', arr);
  return arr;
}

/** Encode points for a brand-new draw shape's Y.Array. */
export function encodePointsForStorage(points: DrawPoint[]): number[] {
  return encodeTriples(points);
}
