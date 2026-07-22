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
 */

function samePoint(a: DrawPoint, b: DrawPoint): boolean {
  return a.x === b.x && a.y === b.y && a.pressure === b.pressure;
}

/**
 * Materialize a draw shape's points, accepting either storage form.
 *
 * Strokes drawn before points moved to a Y.Array keep their plain array inside
 * `props`. They are read in place and only converted if they are edited — the
 * same read-both, write-new arrangement used for text shapes vs Y.Text.
 */
export function readPoints(
  m: Y.Map<unknown>,
  storedProps: Record<string, unknown>,
): DrawPoint[] {
  const arr = m.get('points');
  if (arr instanceof Y.Array) return arr.toArray() as DrawPoint[];
  return Array.isArray(storedProps.points)
    ? (storedProps.points as DrawPoint[])
    : [];
}

/**
 * Write `next` into a points Y.Array, appending when possible.
 *
 * The live stroke only ever grows, so it takes the append branch and each frame
 * costs just the new points. The replace branch covers the commit-time
 * simplification (which rewrites the array with fewer points) and programmatic
 * edits; it runs once per stroke, not once per frame.
 */
export function syncYPoints(arr: Y.Array<DrawPoint>, next: DrawPoint[]): void {
  // One `toArray` then a plain-array scan. Indexing a Y.Array is O(log n) per
  // access, so comparing through `arr.get(i)` would cost O(n log n) per frame —
  // worse than the whole-array write this replaces. Materializing once is O(n),
  // the same cost the caller already pays to build `next`.
  const current = arr.toArray();
  if (next.length >= current.length) {
    let isAppend = true;
    for (let i = 0; i < current.length; i++) {
      if (!samePoint(current[i]!, next[i]!)) {
        isAppend = false;
        break;
      }
    }
    if (isAppend) {
      if (next.length > current.length) arr.push(next.slice(current.length));
      return;
    }
  }
  arr.delete(0, current.length);
  arr.insert(0, next);
}

/**
 * The Y.Array holding a shape's points, converting a legacy stroke on first
 * write. Seeded from the old scalar array so no points are lost.
 */
export function ensurePointsArray(m: Y.Map<unknown>): Y.Array<DrawPoint> {
  const existing = m.get('points');
  if (existing instanceof Y.Array) return existing as Y.Array<DrawPoint>;
  const legacy = m.get('props') as { points?: unknown } | undefined;
  const arr = Y.Array.from(
    Array.isArray(legacy?.points) ? (legacy.points as DrawPoint[]) : [],
  );
  m.set('points', arr);
  return arr;
}
