import type { Bounds, Point } from '@whiteboard/shared';
import { snapCoordinateToGrid } from './grid';

/** A transient alignment indicator in world coordinates. */
export interface SnapGuide {
  /** Alignment axis, or spacing direction for a gap guide. */
  axis: 'x' | 'y';
  /** Alignment coordinate; for gaps this is the cross-axis coordinate. */
  at: number;
  /** Span along the guide. */
  from: number;
  to: number;
  kind?: 'alignment' | 'gap' | 'point';
}

export interface SnapResult {
  /** Extra offset to add to the raw drag. */
  dx: number;
  dy: number;
  guides: SnapGuide[];
}

export interface ResizeSnapResult extends SnapResult {
  bounds: Bounds;
}

/** Discrete points plus a sampled/linear outline used by connector handles. */
export interface PointSnapTarget {
  /** Owning shape, when this target came from document geometry. */
  shapeId?: string;
  points: Point[];
  outline: Point[];
  closed: boolean;
}

export interface PointSnapResult {
  point: Point;
  guides: SnapGuide[];
  targetId?: string;
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
  /** Bounds of the shape we snapped to (null for a grid snap). */
  matched: Bounds | null;
}

function emptyBest(threshold: number): Best {
  return { dist: threshold + 1, offset: 0, target: 0, matched: null };
}

function bestAlong(
  moving: number[],
  others: Bounds[],
  pick: (b: Bounds) => number[],
  gridStep: number | null,
  threshold: number,
): Best {
  let best = emptyBest(threshold);
  for (const other of others) {
    for (const target of pick(other)) {
      for (const value of moving) {
        const dist = Math.abs(target - value);
        if (dist < best.dist) {
          best = { dist, offset: target - value, target, matched: other };
        }
      }
    }
  }
  if (gridStep && gridStep > 0) {
    for (const value of moving) {
      const target = snapCoordinateToGrid(value, gridStep);
      const dist = Math.abs(target - value);
      if (dist < best.dist) {
        best = { dist, offset: target - value, target, matched: null };
      }
    }
  }
  return best;
}

function collectAligned(
  others: Bounds[],
  pick: (b: Bounds) => number[],
  target: number,
): Bounds[] {
  return others.filter((other) =>
    pick(other).some((value) => Math.abs(value - target) < EPS),
  );
}

function alignmentGuide(
  axis: 'x' | 'y',
  best: Best,
  moving: Bounds,
  others: Bounds[],
): SnapGuide | null {
  if (!best.matched) return null;
  const pick = axis === 'x' ? candidatesX : candidatesY;
  const aligned = collectAligned(others, pick, best.target);
  let from = axis === 'x' ? moving.minY : moving.minX;
  let to = axis === 'x' ? moving.maxY : moving.maxX;
  for (const other of aligned) {
    from = Math.min(from, axis === 'x' ? other.minY : other.minX);
    to = Math.max(to, axis === 'x' ? other.maxY : other.maxX);
  }
  return { kind: 'alignment', axis, at: best.target, from, to };
}

function overlaps(a0: number, a1: number, b0: number, b1: number): boolean {
  return Math.max(a0, b0) <= Math.min(a1, b1);
}

interface GapCandidate {
  dist: number;
  offset: number;
  guides: SnapGuide[];
}

interface GapBest {
  dist: number;
  offset: number;
  /** Spacing this placement reproduces, used to find the rest of the chain. */
  gapLength: number;
  /** Cross-axis coordinate the guides are drawn at. */
  at: number;
  /** Cross-axis band the participating boxes share. */
  cross: readonly [number, number];
  intervals: Array<readonly [number, number]>;
}

/**
 * Every equally spaced gap in the run containing the snapped box, so a chain of
 * three or more evenly spaced shapes shows a marker per gap rather than only
 * for the pair that drove the snap.
 */
function gapChainIntervals(
  axis: 'x' | 'y',
  boxes: Bounds[],
  gapLength: number,
  cross: readonly [number, number],
): Array<readonly [number, number]> {
  const start = (b: Bounds) => (axis === 'x' ? b.minX : b.minY);
  const end = (b: Bounds) => (axis === 'x' ? b.maxX : b.maxY);
  const crossStart = (b: Bounds) => (axis === 'x' ? b.minY : b.minX);
  const crossEnd = (b: Bounds) => (axis === 'x' ? b.maxY : b.maxX);

  // Only boxes sharing the band can be part of the same visual run.
  const band = boxes
    .filter((b) => overlaps(crossStart(b), crossEnd(b), cross[0], cross[1]))
    .sort((a, b) => start(a) - start(b));

  const intervals: Array<readonly [number, number]> = [];
  for (let i = 0; i + 1 < band.length; i++) {
    const a = band[i]!;
    const b = band[i + 1]!;
    if (end(a) >= start(b)) continue;
    if (Math.abs(start(b) - end(a) - gapLength) < EPS) {
      intervals.push([end(a), start(b)]);
    }
  }
  return intervals;
}

/**
 * Find a centered-gap or repeated-gap placement along one axis. Static pairs
 * must overlap on the cross axis, which prevents unrelated rows/columns from
 * creating noisy distribution snaps.
 */
function bestGapAlong(
  axis: 'x' | 'y',
  moving: Bounds,
  others: Bounds[],
  threshold: number,
): GapCandidate | null {
  const start = (b: Bounds) => (axis === 'x' ? b.minX : b.minY);
  const end = (b: Bounds) => (axis === 'x' ? b.maxX : b.maxY);
  const crossStart = (b: Bounds) => (axis === 'x' ? b.minY : b.minX);
  const crossEnd = (b: Bounds) => (axis === 'x' ? b.maxY : b.maxX);
  const movingSize = end(moving) - start(moving);
  const movingCenter = (start(moving) + end(moving)) / 2;
  let best: GapBest | null = null;

  const register = (
    offset: number,
    pair: readonly [Bounds, Bounds],
    gapLength: number,
    intervals: Array<readonly [number, number]>,
  ) => {
    const dist = Math.abs(offset);
    if (dist > threshold) return;
    const pairCross: readonly [number, number] = [
      Math.max(crossStart(pair[0]), crossStart(pair[1])),
      Math.min(crossEnd(pair[0]), crossEnd(pair[1])),
    ];
    if (best) {
      if (dist > best.dist + EPS) return;
      // Equally good placements: keep the tighter gap when the two candidates
      // share a band, so a nested run wins over the gap enclosing it.
      if (Math.abs(dist - best.dist) <= EPS) {
        const sameBand = overlaps(
          pairCross[0],
          pairCross[1],
          best.cross[0],
          best.cross[1],
        );
        if (!sameBand || best.gapLength <= gapLength) return;
      }
    }
    const cross0 = Math.max(crossStart(moving), pairCross[0]);
    const cross1 = Math.min(crossEnd(moving), pairCross[1]);
    const at = cross0 <= cross1
      ? (cross0 + cross1) / 2
      : (pairCross[0] + pairCross[1]) / 2;
    best = {
      dist,
      offset,
      gapLength,
      at,
      cross: pairCross,
      intervals,
    };
  };

  for (let i = 0; i < others.length; i++) {
    for (let j = i + 1; j < others.length; j++) {
      let a = others[i]!;
      let b = others[j]!;
      if (start(a) > start(b)) [a, b] = [b, a];
      if (end(a) >= start(b)) continue;
      const pairCross0 = Math.max(crossStart(a), crossStart(b));
      const pairCross1 = Math.min(crossEnd(a), crossEnd(b));
      if (pairCross0 > pairCross1) continue;
      if (!overlaps(crossStart(moving), crossEnd(moving), pairCross0, pairCross1)) {
        continue;
      }

      const gap = start(b) - end(a);
      const pair: readonly [Bounds, Bounds] = [a, b];

      // Center the moving box in the static gap.
      if (movingSize <= gap + EPS) {
        const desiredCenter = (end(a) + start(b)) / 2;
        const offset = desiredCenter - movingCenter;
        const movedStart = start(moving) + offset;
        const movedEnd = end(moving) + offset;
        register(offset, pair, (gap - movingSize) / 2, [
          [end(a), movedStart],
          [movedEnd, start(b)],
        ]);
      }

      // Extend the pair on either side using its existing gap length.
      const leftOffset = start(a) - gap - end(moving);
      register(leftOffset, pair, gap, [
        [end(moving) + leftOffset, start(a)],
        [end(a), start(b)],
      ]);
      const rightOffset = end(b) + gap - start(moving);
      register(rightOffset, pair, gap, [
        [end(a), start(b)],
        [end(b), start(moving) + rightOffset],
      ]);
    }
  }

  if (!best) return null;
  const chosen: GapBest = best;
  const snapped: Bounds = axis === 'x'
    ? {
        ...moving,
        minX: moving.minX + chosen.offset,
        maxX: moving.maxX + chosen.offset,
      }
    : {
        ...moving,
        minY: moving.minY + chosen.offset,
        maxY: moving.maxY + chosen.offset,
      };
  const intervals = [
    ...chosen.intervals,
    ...gapChainIntervals(axis, [...others, snapped], chosen.gapLength, chosen.cross),
  ];

  const seen = new Set<string>();
  const guides: SnapGuide[] = [];
  for (const [from, to] of [...intervals].sort((a, b) => a[0] - b[0])) {
    if (to - from <= EPS) continue;
    const key = `${Math.round(from / EPS)}:${Math.round(to / EPS)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    guides.push({ kind: 'gap', axis, at: chosen.at, from, to });
  }
  return { dist: chosen.dist, offset: chosen.offset, guides };
}

/**
 * Snap a moving bounding box to shape edges/centers, grid intervals, and equal
 * spacing. X and Y are solved independently so a drag may snap on one axis.
 */
export function snapBounds(
  moving: Bounds,
  others: Bounds[],
  gridStep: number | null,
  threshold: number,
): SnapResult {
  const bx = bestAlong(candidatesX(moving), others, candidatesX, gridStep, threshold);
  const by = bestAlong(candidatesY(moving), others, candidatesY, gridStep, threshold);
  const gapX = bestGapAlong('x', moving, others, threshold);
  const gapY = bestGapAlong('y', moving, others, threshold);

  const useGapX = !!gapX && gapX.dist < bx.dist;
  const useGapY = !!gapY && gapY.dist < by.dist;
  const dx = useGapX ? gapX.offset : bx.dist <= threshold ? bx.offset : 0;
  const dy = useGapY ? gapY.offset : by.dist <= threshold ? by.offset : 0;
  const snappedMoving = {
    minX: moving.minX + dx,
    minY: moving.minY + dy,
    maxX: moving.maxX + dx,
    maxY: moving.maxY + dy,
  };

  const guides: SnapGuide[] = [];
  if (useGapX) guides.push(...gapX.guides);
  else if (bx.dist <= threshold) {
    const guide = alignmentGuide('x', bx, snappedMoving, others);
    if (guide) guides.push(guide);
  }
  if (useGapY) guides.push(...gapY.guides);
  else if (by.dist <= threshold) {
    const guide = alignmentGuide('y', by, snappedMoving, others);
    if (guide) guides.push(guide);
  }
  return { dx, dy, guides };
}

/**
 * Snap only the actively resized edges. With a locked corner ratio, the nearer
 * axis wins and the other edge is projected back onto the ratio diagonal.
 */
export function snapResizeBounds(
  moving: Bounds,
  handle: string,
  others: Bounds[],
  gridStep: number | null,
  threshold: number,
  lockAspect: boolean,
  aspectRatio: number,
): ResizeSnapResult {
  const xValue = handle.includes('w')
    ? moving.minX
    : handle.includes('e')
      ? moving.maxX
      : null;
  const yValue = handle.includes('n')
    ? moving.minY
    : handle.includes('s')
      ? moving.maxY
      : null;
  const bx = xValue === null
    ? emptyBest(threshold)
    : bestAlong([xValue], others, candidatesX, gridStep, threshold);
  const by = yValue === null
    ? emptyBest(threshold)
    : bestAlong([yValue], others, candidatesY, gridStep, threshold);
  const validX = xValue !== null && bx.dist <= threshold;
  const validY = yValue !== null && by.dist <= threshold;
  const bounds = { ...moving };
  let useX = validX;
  let useY = validY;

  if (lockAspect && xValue !== null && yValue !== null && (validX || validY)) {
    useX = validX && (!validY || bx.dist < by.dist);
    useY = !useX && validY;
    const ratio = Math.max(EPS, aspectRatio);
    const anchorX = handle.includes('w') ? moving.maxX : moving.minX;
    const anchorY = handle.includes('n') ? moving.maxY : moving.minY;
    const signX = handle.includes('w') ? -1 : 1;
    const signY = handle.includes('n') ? -1 : 1;
    if (useX) {
      const draggedX = xValue + bx.offset;
      const width = Math.abs(draggedX - anchorX);
      const draggedY = anchorY + signY * (width / ratio);
      if (signX < 0) bounds.minX = draggedX;
      else bounds.maxX = draggedX;
      if (signY < 0) bounds.minY = draggedY;
      else bounds.maxY = draggedY;
    } else {
      const draggedY = yValue + by.offset;
      const height = Math.abs(draggedY - anchorY);
      const draggedX = anchorX + signX * height * ratio;
      if (signY < 0) bounds.minY = draggedY;
      else bounds.maxY = draggedY;
      if (signX < 0) bounds.minX = draggedX;
      else bounds.maxX = draggedX;
    }
  } else {
    if (validX) {
      if (handle.includes('w')) bounds.minX += bx.offset;
      else bounds.maxX += bx.offset;
    }
    if (validY) {
      if (handle.includes('n')) bounds.minY += by.offset;
      else bounds.maxY += by.offset;
    }
  }

  const guides: SnapGuide[] = [];
  if (useX) {
    const guide = alignmentGuide('x', bx, bounds, others);
    if (guide) guides.push(guide);
  }
  if (useY) {
    const guide = alignmentGuide('y', by, bounds, others);
    if (guide) guides.push(guide);
  }
  return {
    bounds,
    dx: bounds.minX - moving.minX + (bounds.maxX - moving.maxX),
    dy: bounds.minY - moving.minY + (bounds.maxY - moving.maxY),
    guides,
  };
}

function closestPointOnSegment(point: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq < EPS * EPS) return a;
  const t = Math.max(
    0,
    Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq),
  );
  return { x: a.x + t * dx, y: a.y + t * dy };
}

/** Snap a connector/control handle to the nearest discrete point or outline. */
export function snapPoint(
  point: Point,
  targets: PointSnapTarget[],
  threshold: number,
): PointSnapResult {
  let bestPoint: Point = point;
  let bestDistance = threshold + 1;
  let found = false;
  let targetId: string | undefined;
  const consider = (candidate: Point, candidateTargetId?: string) => {
    const dist = Math.hypot(candidate.x - point.x, candidate.y - point.y);
    if (dist < bestDistance) {
      bestDistance = dist;
      bestPoint = candidate;
      found = true;
      targetId = candidateTargetId;
    }
  };

  // Discrete snap points win ties over outline projections.
  for (const target of targets) {
    for (const candidate of target.points) consider(candidate, target.shapeId);
  }
  for (const target of targets) {
    const { outline } = target;
    const segmentCount = target.closed ? outline.length : outline.length - 1;
    for (let i = 0; i < segmentCount; i++) {
      const a = outline[i];
      const b = outline[(i + 1) % outline.length];
      if (a && b) {
        consider(closestPointOnSegment(point, a, b), target.shapeId);
      }
    }
  }

  if (!found || bestDistance > threshold) return alignPoint(point, targets, threshold);
  return {
    point: bestPoint,
    targetId,
    guides: [
      {
        kind: 'point',
        axis: 'x',
        at: bestPoint.x,
        from: bestPoint.y,
        to: bestPoint.y,
      },
    ],
  };
}

/**
 * Fallback for a handle with no point or outline within reach: line it up with
 * a key point's X and/or Y independently, drawing a guide to that point.
 */
function alignPoint(
  point: Point,
  targets: PointSnapTarget[],
  threshold: number,
): PointSnapResult {
  let bestX: { dist: number; at: number; other: number } | null = null;
  let bestY: { dist: number; at: number; other: number } | null = null;

  for (const target of targets) {
    for (const candidate of target.points) {
      const dx = Math.abs(candidate.x - point.x);
      if (dx <= threshold && (!bestX || dx < bestX.dist)) {
        bestX = { dist: dx, at: candidate.x, other: candidate.y };
      }
      const dy = Math.abs(candidate.y - point.y);
      if (dy <= threshold && (!bestY || dy < bestY.dist)) {
        bestY = { dist: dy, at: candidate.y, other: candidate.x };
      }
    }
  }

  if (!bestX && !bestY) return { point, guides: [] };
  const snapped = { x: bestX ? bestX.at : point.x, y: bestY ? bestY.at : point.y };
  const guides: SnapGuide[] = [];
  if (bestX) {
    guides.push({
      kind: 'alignment',
      axis: 'x',
      at: snapped.x,
      from: Math.min(snapped.y, bestX.other),
      to: Math.max(snapped.y, bestX.other),
    });
  }
  if (bestY) {
    guides.push({
      kind: 'alignment',
      axis: 'y',
      at: snapped.y,
      from: Math.min(snapped.x, bestY.other),
      to: Math.max(snapped.x, bestY.other),
    });
  }
  return { point: snapped, guides };
}
