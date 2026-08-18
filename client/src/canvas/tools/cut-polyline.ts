import type { Point } from '@whiteboard/shared';

/**
 * Capsule/polyline clipping for the precision eraser.
 *
 * The eraser sweeps the *segment* between two pointer samples, so the region it
 * removes is that segment's Minkowski sum with a disc of radius `r` — a capsule.
 * The cut is solved per polyline segment in closed form rather than by testing
 * each stored point for membership: ink samples sit about one world unit apart
 * (see NOMINAL_SAMPLE_SPACING), and zoomed in the eraser's world-space radius
 * shrinks below that, so a per-point test would pass between two samples and cut
 * nothing where the user clearly rubbed through the line.
 */

/** A closed sub-interval of a segment's parameter t, always within [0, 1]. */
type Interval = [number, number];

/** Intervals of [lo, hi] where `c + t*d <= 0` holds, or null when never. */
function affineBelowZero(c: number, d: number): Interval | null {
  // Constant in t: the whole parameter range either satisfies it or none of it.
  if (d === 0) return c <= 0 ? [0, 1] : null;
  const t = -c / d;
  return d > 0 ? [0, Math.min(1, t)] : [Math.max(0, t), 1];
}

function intersect(a: Interval | null, b: Interval | null): Interval | null {
  if (!a || !b) return null;
  const lo = Math.max(a[0], b[0]);
  const hi = Math.min(a[1], b[1]);
  return lo <= hi ? [lo, hi] : null;
}

/** Interval of t in [0,1] where |p + t*(q-p) - c| <= r. */
function discInterval(p: Point, q: Point, c: Point, r: number): Interval | null {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const fx = p.x - c.x;
  const fy = p.y - c.y;
  const a = dx * dx + dy * dy;
  const b = 2 * (fx * dx + fy * dy);
  const k = fx * fx + fy * fy - r * r;
  // Degenerate segment (both endpoints coincide): membership is all-or-nothing.
  if (a === 0) return k <= 0 ? [0, 1] : null;
  const disc = b * b - 4 * a * k;
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  const lo = Math.max(0, (-b - root) / (2 * a));
  const hi = Math.min(1, (-b + root) / (2 * a));
  return lo <= hi ? [lo, hi] : null;
}

/**
 * The sub-intervals of segment p→q (as t in [0, 1]) that lie within `r` of the
 * swipe segment a→b, sorted and merged.
 *
 * A capsule is a rectangular slab capped by a disc at each end, and each piece
 * is cheap to solve because both the projection along a→b and the perpendicular
 * offset from it are *affine* in t: the slab reduces to intersecting four affine
 * inequalities, and each cap to one quadratic.
 */
export function capsuleIntervals(
  p: Point,
  q: Point,
  a: Point,
  b: Point,
  r: number,
): Interval[] {
  const parts: Interval[] = [];

  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const len2 = ex * ex + ey * ey;
  if (len2 > 0) {
    // u(t) and h(t) are the projection along a→b and the perpendicular offset,
    // both affine in t. The slab is |h| <= r intersected with 0 <= u <= 1.
    const len = Math.sqrt(len2);
    const ux = ex / len;
    const uy = ey / len;
    const u0 = (p.x - a.x) * ux + (p.y - a.y) * uy;
    const du = (q.x - p.x) * ux + (q.y - p.y) * uy;
    const h0 = (p.x - a.x) * -uy + (p.y - a.y) * ux;
    const dh = (q.x - p.x) * -uy + (q.y - p.y) * ux;
    let slab = intersect(
      affineBelowZero(h0 - r, dh), // h <= r
      affineBelowZero(-h0 - r, -dh), // h >= -r
    );
    slab = intersect(slab, affineBelowZero(-u0, -du)); // u >= 0
    slab = intersect(slab, affineBelowZero(u0 - len, du)); // u <= len
    if (slab) parts.push(slab);
  }

  const capA = discInterval(p, q, a, r);
  if (capA) parts.push(capA);
  // A click, or two samples at the same spot, is a bare disc — one cap only.
  if (len2 > 0) {
    const capB = discInterval(p, q, b, r);
    if (capB) parts.push(capB);
  }

  if (parts.length < 2) return parts;
  parts.sort((x, y) => x[0] - y[0]);
  const merged: Interval[] = [parts[0]!];
  for (let i = 1; i < parts.length; i++) {
    const last = merged[merged.length - 1]!;
    const next = parts[i]!;
    if (next[0] <= last[1]) last[1] = Math.max(last[1], next[1]);
    else merged.push(next);
  }
  return merged;
}

/**
 * Split `points` wherever the capsule around a→b covers it, returning the
 * surviving runs in order.
 *
 * A point is inserted at each cut boundary via `lerp`, so the surviving ends sit
 * exactly on the eraser's edge rather than at the nearest stored sample — that
 * is what makes the cut land where the cursor was at any zoom. Runs of fewer
 * than two points are dropped: a lone leftover sample renders as a stray dot
 * that nobody drew. A single-point input (a tapped dot) is kept or removed
 * whole, since it has no interior to cut.
 */
export function cutPolyline<T extends Point>(
  points: readonly T[],
  a: Point,
  b: Point,
  r: number,
  lerp: (from: T, to: T, t: number) => T,
): T[][] {
  if (points.length === 0) return [];
  if (points.length === 1) {
    const only = points[0]!;
    const covered = capsuleIntervals(only, only, a, b, r).length > 0;
    return covered ? [] : [[only]];
  }

  const runs: T[][] = [];
  let current: T[] = [];

  const flush = () => {
    if (current.length >= 2) runs.push(current);
    current = [];
  };
  const add = (point: T) => {
    const last = current[current.length - 1];
    // Segment joins would otherwise repeat the shared vertex.
    if (last && last.x === point.x && last.y === point.y) return;
    current.push(point);
  };

  for (let i = 0; i < points.length - 1; i++) {
    const p = points[i]!;
    const q = points[i + 1]!;
    const covered = capsuleIntervals(p, q, a, b, r);
    let cursor = 0;
    for (const [lo, hi] of covered) {
      if (lo > cursor) {
        add(cursor === 0 ? p : lerp(p, q, cursor));
        add(lerp(p, q, lo));
      }
      // Anything open ends at the cut's leading edge; the run past it is new.
      flush();
      cursor = hi;
    }
    if (cursor < 1) add(cursor === 0 ? p : lerp(p, q, cursor));
  }
  // The final vertex belongs to the run left open by the last segment.
  if (current.length > 0) add(points[points.length - 1]!);
  flush();

  return runs;
}
