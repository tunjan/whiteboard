import type { Bounds } from '@whiteboard/shared';
import { snapCoordinateToGrid } from './grid';

/** A single alignment guide line to draw (world coordinates). */
export interface SnapGuide {
  axis: 'x' | 'y';
  /** World coordinate of the line on its axis. */
  at: number;
  /** Span of the line along the other axis. */
  from: number;
  to: number;
}

export interface SnapResult {
  /** Extra offset to add to the raw drag so edges/centers line up. */
  dx: number;
  dy: number;
  guides: SnapGuide[];
}

const EPS = 0.01;

function candidatesX(b: Bounds): number[] {
  return [b.minX, (b.minX + b.maxX) / 2, b.maxX];
}
function candidatesY(b: Bounds): number[] {
  return [b.minY, (b.minY + b.maxY) / 2, b.maxY];
}

interface Best {
  dist: number;
  offset: number;
  target: number;
  /** Bounds of the shape we snapped to (null for a grid snap → no guide). */
  matched: Bounds | null;
}

function bestAlong(
  moving: number[],
  others: Bounds[],
  pick: (b: Bounds) => number[],
  gridStep: number | null,
  threshold: number,
): Best {
  let best: Best = { dist: threshold + 1, offset: 0, target: 0, matched: null };
  for (const ob of others) {
    for (const t of pick(ob)) {
      for (const m of moving) {
        const d = Math.abs(t - m);
        if (d < best.dist) best = { dist: d, offset: t - m, target: t, matched: ob };
      }
    }
  }
  if (gridStep && gridStep > 0) {
    for (const m of moving) {
      const t = snapCoordinateToGrid(m, gridStep);
      const d = Math.abs(t - m);
      if (d < best.dist) best = { dist: d, offset: t - m, target: t, matched: null };
    }
  }
  return best;
}

/**
 * Snap a moving bounding box to other shapes' edges/centers and (optionally) to
 * grid intervals, independently per axis. Returns the residual offset to apply
 * plus the guide lines for any shape-alignment matches.
 */
export function snapBounds(
  moving: Bounds,
  others: Bounds[],
  gridStep: number | null,
  threshold: number,
): SnapResult {
  const bx = bestAlong(candidatesX(moving), others, candidatesX, gridStep, threshold);
  const by = bestAlong(candidatesY(moving), others, candidatesY, gridStep, threshold);
  const dx = bx.dist <= threshold ? bx.offset : 0;
  const dy = by.dist <= threshold ? by.offset : 0;

  const guides: SnapGuide[] = [];
  // Draw a vertical guide for the X match, spanning both boxes vertically.
  if (bx.dist <= threshold && bx.matched) {
    const others2 = [bx.matched, ...collectAligned(others, candidatesX, bx.target)];
    let from = moving.minY + dy;
    let to = moving.maxY + dy;
    for (const o of others2) {
      from = Math.min(from, o.minY);
      to = Math.max(to, o.maxY);
    }
    guides.push({ axis: 'x', at: bx.target, from, to });
  }
  if (by.dist <= threshold && by.matched) {
    const others2 = [by.matched, ...collectAligned(others, candidatesY, by.target)];
    let from = moving.minX + dx;
    let to = moving.maxX + dx;
    for (const o of others2) {
      from = Math.min(from, o.minX);
      to = Math.max(to, o.maxX);
    }
    guides.push({ axis: 'y', at: by.target, from, to });
  }
  return { dx, dy, guides };
}

/** Other boxes that also have a candidate exactly at `target` (for guide span). */
function collectAligned(
  others: Bounds[],
  pick: (b: Bounds) => number[],
  target: number,
): Bounds[] {
  return others.filter((o) => pick(o).some((v) => Math.abs(v - target) < EPS));
}
