import {
  type Bounds,
  type Point,
  closestPointOnSegment,
} from '@whiteboard/shared';
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

/** Bounds used for gap calculations plus feature points used for alignment. */
export interface BoundsSnapTarget extends Bounds {
  points: Point[];
}

export type BoundsSnapTargetLike = Bounds | BoundsSnapTarget;

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

const SNAP_PRECISION = 1e8;
const EPS = 1 / SNAP_PRECISION;
const TAU = Math.PI * 2;

/** Normalize comparison noise to the eight decimal places used by snapping. */
function roundSnap(value: number): number {
  return Math.round(value * SNAP_PRECISION) / SNAP_PRECISION;
}

function snapEqual(a: number, b: number): boolean {
  return roundSnap(a) === roundSnap(b);
}

function snapLess(a: number, b: number): boolean {
  return roundSnap(a) < roundSnap(b);
}

function withinSnapThreshold(distance: number, threshold: number): boolean {
  return roundSnap(distance) <= roundSnap(threshold);
}

/** Default object snap geometry: four box corners and its center. */
export function boundsSnapPoints(bounds: Bounds): Point[] {
  const center = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
  return [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
    center,
  ];
}

function targetBounds(target: BoundsSnapTargetLike): Bounds {
  return target;
}

function targetPoints(target: BoundsSnapTargetLike): Point[] {
  return 'points' in target ? target.points : boundsSnapPoints(target);
}

function candidatesX(target: BoundsSnapTargetLike): number[] {
  return targetPoints(target).map((point) => point.x);
}

function candidatesY(target: BoundsSnapTargetLike): number[] {
  return targetPoints(target).map((point) => point.y);
}

interface Best {
  dist: number;
  offset: number;
}

function emptyBest(threshold: number): Best {
  return { dist: threshold + 1, offset: 0 };
}

function hasBest(best: Best, threshold: number): boolean {
  return withinSnapThreshold(best.dist, threshold);
}

/**
 * Pass 1: the smallest displacement along one axis that lands a moving
 * coordinate on a target coordinate (or a grid line).
 */
function bestAlong(
  moving: number[],
  others: BoundsSnapTargetLike[],
  pick: (target: BoundsSnapTargetLike) => number[],
  gridStep: number | null,
  threshold: number,
): Best {
  let best = emptyBest(threshold);
  for (const other of others) {
    for (const target of pick(other)) {
      for (const value of moving) {
        const dist = Math.abs(target - value);
        if (snapLess(dist, best.dist)) best = { dist, offset: target - value };
      }
    }
  }
  if (gridStep && gridStep > 0) {
    for (const value of moving) {
      const target = snapCoordinateToGrid(value, gridStep);
      const dist = Math.abs(target - value);
      if (snapLess(dist, best.dist)) best = { dist, offset: target - value };
    }
  }
  return best;
}

/**
 * Pass 2: every coordinate the settled box shares with a target, so a placement
 * that lines up with several shapes at once — or with one shape on its edge and
 * another on its centre — shows a guide for each rather than only for the pair
 * that drove the nudge. `movingValues` restricts which of the box's own
 * coordinates may align, so a resize only reports its dragged edge.
 */
function alignmentGuides(
  axis: 'x' | 'y',
  movingValues: number[],
  moving: Bounds,
  others: BoundsSnapTargetLike[],
): SnapGuide[] {
  const pick = axis === 'x' ? candidatesX : candidatesY;
  const crossStart = (target: BoundsSnapTargetLike) => {
    const bounds = targetBounds(target);
    return axis === 'x' ? bounds.minY : bounds.minX;
  };
  const crossEnd = (target: BoundsSnapTargetLike) => {
    const bounds = targetBounds(target);
    return axis === 'x' ? bounds.maxY : bounds.maxX;
  };
  const spans = new Map<number, SnapGuide>();

  for (const other of others) {
    for (const target of pick(other)) {
      if (!movingValues.some((value) => snapEqual(value, target))) continue;
      const key = roundSnap(target);
      const guide = spans.get(key) ?? {
        kind: 'alignment' as const,
        axis,
        at: target,
        from: crossStart(moving),
        to: crossEnd(moving),
      };
      guide.from = Math.min(guide.from, crossStart(other));
      guide.to = Math.max(guide.to, crossEnd(other));
      spans.set(key, guide);
    }
  }
  return [...spans.values()].sort((a, b) => a.at - b.at);
}

function overlaps(a0: number, a1: number, b0: number, b1: number): boolean {
  // A shared boundary has no breadth, so it cannot form a row / column gap.
  return snapLess(Math.max(a0, b0), Math.min(a1, b1));
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
    if (snapEqual(start(b) - end(a), gapLength)) {
      intervals.push([end(a), start(b)]);
    }
  }
  return intervals;
}

/** Ascending order of `others` by one coordinate, with that coordinate. */
function sortedBy(
  others: Bounds[],
  key: (b: Bounds) => number,
): { at: Int32Array; keys: Float64Array } {
  const byIndex = Float64Array.from(others, key);
  const at = Int32Array.from(others.keys()).sort(
    (p, q) => byIndex[p]! - byIndex[q]!,
  );
  return { at, keys: Float64Array.from(at, (i) => byIndex[i]!) };
}

/** First index whose key is >= value. */
function lowerBound(keys: Float64Array, value: number): number {
  let lo = 0;
  let hi = keys.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (keys[mid]! < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** One placement a static pair offers: 0 centre, 1 extend left, 2 extend right. */
interface GapHit {
  /** Index of the lower-starting box of the pair, and of the other one. */
  ia: number;
  ib: number;
  kind: 0 | 1 | 2;
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
    if (!withinSnapThreshold(dist, threshold)) return;
    const pairCross: readonly [number, number] = [
      Math.max(crossStart(pair[0]), crossStart(pair[1])),
      Math.min(crossEnd(pair[0]), crossEnd(pair[1])),
    ];
    if (best) {
      if (snapLess(best.dist, dist)) return;
      // Equally good placements: keep the tighter gap when the two candidates
      // share a band, so a nested run wins over the gap enclosing it.
      if (snapEqual(dist, best.dist)) {
        const sameBand = overlaps(
          pairCross[0],
          pairCross[1],
          best.cross[0],
          best.cross[1],
        );
        if (!sameBand || !snapLess(gapLength, best.gapLength)) return;
      }
    }
    const cross0 = Math.max(crossStart(moving), pairCross[0]);
    const cross1 = Math.min(crossEnd(moving), pairCross[1]);
    const at =
      cross0 <= cross1
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

  // Every pair's three placements are a fixed coordinate the moving box must
  // meet, so rather than visit all n² pairs, each box looks up only the partners
  // that would put a placement within reach — a range search over the boxes
  // sorted along the axis. `reach` is a hair wider than the threshold because
  // `register` compares rounded values; it re-checks exactly.
  const reach = threshold + 1e-6;
  const byStart = sortedBy(others, start);
  const byEnd = sortedBy(others, end);
  const hits: GapHit[] = [];
  const touchesMoving = (b: Bounds) =>
    overlaps(crossStart(moving), crossEnd(moving), crossStart(b), crossEnd(b));
  // The scan's orientation: the lower start leads, and a tie keeps the order
  // the two boxes arrived in.
  const leads = (ia: number, ib: number) =>
    start(others[ia]!) < start(others[ib]!) ||
    (start(others[ia]!) === start(others[ib]!) && ia < ib);
  const partners = (
    sorted: { at: Int32Array; keys: Float64Array },
    lo: number,
    hi: number,
    visit: (i: number) => void,
  ) => {
    for (
      let k = lowerBound(sorted.keys, lo);
      k < sorted.keys.length && sorted.keys[k]! <= hi;
      k++
    ) {
      visit(sorted.at[k]!);
    }
  };

  for (let i = 0; i < others.length; i++) {
    const box = others[i]!;
    // The pair's shared band lies inside each box, so a box clear of the moving
    // box's band cannot be in any pair that snaps it.
    if (!touchesMoving(box)) continue;
    // As the leading box: centring needs start(b) ≈ 2·centre − end(a), and
    // extending left needs start(b) ≈ start(a) + end(a) − end(moving).
    const centreAt = 2 * movingCenter - end(box);
    partners(byStart, centreAt - 2 * reach, centreAt + 2 * reach, (j) => {
      if (j !== i && leads(i, j)) hits.push({ ia: i, ib: j, kind: 0 });
    });
    const leftAt = start(box) + end(box) - end(moving);
    partners(byStart, leftAt - reach, leftAt + reach, (j) => {
      if (j !== i && leads(i, j)) hits.push({ ia: i, ib: j, kind: 1 });
    });
    // As the trailing box: extending right needs end(a) ≈ end(b) + start(b) −
    // start(moving).
    const rightAt = end(box) + start(box) - start(moving);
    partners(byEnd, rightAt - reach, rightAt + reach, (j) => {
      if (j !== i && leads(j, i)) hits.push({ ia: j, ib: i, kind: 2 });
    });
  }
  // Equal-distance ties keep the first candidate registered, so replay the hits
  // in the order a scan over every pair (i < j), then every placement, visits.
  hits.sort(
    (p, q) =>
      Math.min(p.ia, p.ib) - Math.min(q.ia, q.ib) ||
      Math.max(p.ia, p.ib) - Math.max(q.ia, q.ib) ||
      p.kind - q.kind,
  );

  for (const { ia, ib, kind } of hits) {
    const a = others[ia]!;
    const b = others[ib]!;
    if (end(a) >= start(b)) continue;
    const pairCross0 = Math.max(crossStart(a), crossStart(b));
    const pairCross1 = Math.min(crossEnd(a), crossEnd(b));
    if (!overlaps(crossStart(a), crossEnd(a), crossStart(b), crossEnd(b))) {
      continue;
    }
    if (
      !overlaps(crossStart(moving), crossEnd(moving), pairCross0, pairCross1)
    ) {
      continue;
    }

    const gap = start(b) - end(a);
    const pair: readonly [Bounds, Bounds] = [a, b];

    if (kind === 0) {
      // Center the moving box in the static gap.
      if (snapLess(gap, movingSize)) continue;
      const desiredCenter = (end(a) + start(b)) / 2;
      const offset = desiredCenter - movingCenter;
      const movedStart = start(moving) + offset;
      const movedEnd = end(moving) + offset;
      register(offset, pair, (gap - movingSize) / 2, [
        [end(a), movedStart],
        [movedEnd, start(b)],
      ]);
    } else if (kind === 1) {
      // Extend the pair on either side using its existing gap length.
      const leftOffset = start(a) - gap - end(moving);
      register(leftOffset, pair, gap, [
        [end(moving) + leftOffset, start(a)],
        [end(a), start(b)],
      ]);
    } else {
      const rightOffset = end(b) + gap - start(moving);
      register(rightOffset, pair, gap, [
        [end(a), start(b)],
        [end(b), start(moving) + rightOffset],
      ]);
    }
  }

  if (!best) return null;
  const chosen: GapBest = best;
  const snapped: Bounds =
    axis === 'x'
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
    ...gapChainIntervals(
      axis,
      [...others, snapped],
      chosen.gapLength,
      chosen.cross,
    ),
  ];

  const seen = new Set<string>();
  const guides: SnapGuide[] = [];
  for (const [from, to] of [...intervals].sort((a, b) => a[0] - b[0])) {
    if (!snapLess(0, to - from)) continue;
    const key = `${roundSnap(from)}:${roundSnap(to)}`;
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
  others: BoundsSnapTargetLike[],
  gridStep: number | null,
  threshold: number,
  options?: { points?: Point[]; axis?: 'x' | 'y' | null },
): SnapResult {
  const movingPoints = options?.points ?? boundsSnapPoints(moving);
  const movingX = movingPoints.map((point) => point.x);
  const movingY = movingPoints.map((point) => point.y);
  const canSnapX = options?.axis !== 'y';
  const canSnapY = options?.axis !== 'x';
  const otherBounds = others.map(targetBounds);
  // Resolve object / distribution snaps first. Grid snapping is a fallback for
  // the whole gesture sample: once any object guide is active, the grid must
  // not pull the unsnapped axis away from the pointer.
  const bx = canSnapX
    ? bestAlong(movingX, others, candidatesX, null, threshold)
    : emptyBest(threshold);
  const by = canSnapY
    ? bestAlong(movingY, others, candidatesY, null, threshold)
    : emptyBest(threshold);
  const gapX = canSnapX
    ? bestGapAlong('x', moving, otherBounds, threshold)
    : null;
  const gapY = canSnapY
    ? bestGapAlong('y', moving, otherBounds, threshold)
    : null;

  const useGapX =
    !!gapX && (!hasBest(bx, threshold) || snapLess(gapX.dist, bx.dist));
  const useGapY =
    !!gapY && (!hasBest(by, threshold) || snapLess(gapY.dist, by.dist));
  const hasObjectX = useGapX || hasBest(bx, threshold);
  const hasObjectY = useGapY || hasBest(by, threshold);
  const hasObjectSnap = hasObjectX || hasObjectY;
  const gridX =
    hasObjectSnap || !canSnapX
      ? emptyBest(threshold)
      : bestAlong(movingX, [], candidatesX, gridStep, threshold);
  const gridY =
    hasObjectSnap || !canSnapY
      ? emptyBest(threshold)
      : bestAlong(movingY, [], candidatesY, gridStep, threshold);
  const dx = useGapX
    ? gapX.offset
    : hasBest(bx, threshold)
      ? bx.offset
      : hasBest(gridX, threshold)
        ? gridX.offset
        : 0;
  const dy = useGapY
    ? gapY.offset
    : hasBest(by, threshold)
      ? by.offset
      : hasBest(gridY, threshold)
        ? gridY.offset
        : 0;
  const snappedMoving = {
    minX: moving.minX + dx,
    minY: moving.minY + dy,
    maxX: moving.maxX + dx,
    maxY: moving.maxY + dy,
  };
  const snappedMovingPoints = movingPoints.map((point) => ({
    x: point.x + dx,
    y: point.y + dy,
  }));

  const guides: SnapGuide[] = [];
  if (useGapX) guides.push(...gapX.guides);
  else if (hasBest(bx, threshold)) {
    guides.push(
      ...alignmentGuides(
        'x',
        snappedMovingPoints.map((point) => point.x),
        snappedMoving,
        others,
      ),
    );
  }
  if (useGapY) guides.push(...gapY.guides);
  else if (hasBest(by, threshold)) {
    guides.push(
      ...alignmentGuides(
        'y',
        snappedMovingPoints.map((point) => point.y),
        snappedMoving,
        others,
      ),
    );
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
  others: BoundsSnapTargetLike[],
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
  const objectX =
    xValue === null
      ? emptyBest(threshold)
      : bestAlong([xValue], others, candidatesX, null, threshold);
  const objectY =
    yValue === null
      ? emptyBest(threshold)
      : bestAlong([yValue], others, candidatesY, null, threshold);
  const hasObjectSnap =
    (xValue !== null && hasBest(objectX, threshold)) ||
    (yValue !== null && hasBest(objectY, threshold));
  const bx =
    hasObjectSnap || xValue === null
      ? objectX
      : bestAlong([xValue], [], candidatesX, gridStep, threshold);
  const by =
    hasObjectSnap || yValue === null
      ? objectY
      : bestAlong([yValue], [], candidatesY, gridStep, threshold);
  const validX = xValue !== null && hasBest(bx, threshold);
  const validY = yValue !== null && hasBest(by, threshold);
  const bounds = { ...moving };
  let useX = validX;
  let useY = validY;

  if (lockAspect && xValue !== null && yValue !== null && (validX || validY)) {
    // An axis already at zero displacement must not mask a useful snap on the
    // other axis. Otherwise the smaller non-zero correction is dominant.
    const movesX = validX && !snapEqual(bx.dist, 0);
    const movesY = validY && !snapEqual(by.dist, 0);
    useX = movesX ? !movesY || snapLess(bx.dist, by.dist) : !movesY && validX;
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

  // Only the dragged edge is reported: a stationary edge that happens to line up
  // with a target was not part of this snap.
  const guides: SnapGuide[] = [];
  if (useX) {
    const edge = handle.includes('w') ? bounds.minX : bounds.maxX;
    guides.push(...alignmentGuides('x', [edge], bounds, others));
  }
  if (useY) {
    const edge = handle.includes('n') ? bounds.minY : bounds.maxY;
    guides.push(...alignmentGuides('y', [edge], bounds, others));
  }
  return {
    bounds,
    dx: bounds.minX - moving.minX + (bounds.maxX - moving.maxX),
    dy: bounds.minY - moving.minY + (bounds.maxY - moving.maxY),
    guides,
  };
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
    if (withinSnapThreshold(dist, threshold) && snapLess(dist, bestDistance)) {
      bestDistance = dist;
      bestPoint = candidate;
      found = true;
      targetId = candidateTargetId;
    }
  };

  // Discrete feature points have strict priority over outline projections,
  // even when a nearby outline happens to be geometrically closer.
  for (const target of targets) {
    for (const candidate of target.points) consider(candidate, target.shapeId);
  }
  if (found) {
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

  bestDistance = threshold + 1;
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

  if (!found) return alignPoint(point, targets, threshold);
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
      if (
        withinSnapThreshold(dx, threshold) &&
        (!bestX || snapLess(dx, bestX.dist))
      ) {
        bestX = { dist: dx, at: candidate.x, other: candidate.y };
      }
      const dy = Math.abs(candidate.y - point.y);
      if (
        withinSnapThreshold(dy, threshold) &&
        (!bestY || snapLess(dy, bestY.dist))
      ) {
        bestY = { dist: dy, at: candidate.y, other: candidate.x };
      }
    }
  }

  if (!bestX && !bestY) return { point, guides: [] };
  const snapped = {
    x: bestX ? bestX.at : point.x,
    y: bestY ? bestY.at : point.y,
  };
  const guides: SnapGuide[] = [];
  if (bestX) {
    let from = snapped.y;
    let to = snapped.y;
    for (const target of targets) {
      for (const candidate of target.points) {
        if (!snapEqual(candidate.x, snapped.x)) continue;
        from = Math.min(from, candidate.y);
        to = Math.max(to, candidate.y);
      }
    }
    guides.push({
      kind: 'alignment',
      axis: 'x',
      at: snapped.x,
      from,
      to,
    });
  }
  if (bestY) {
    let from = snapped.x;
    let to = snapped.x;
    for (const target of targets) {
      for (const candidate of target.points) {
        if (!snapEqual(candidate.y, snapped.y)) continue;
        from = Math.min(from, candidate.x);
        to = Math.max(to, candidate.x);
      }
    }
    guides.push({
      kind: 'alignment',
      axis: 'y',
      at: snapped.y,
      from,
      to,
    });
  }
  return { point: snapped, guides };
}

function clampRadians(angle: number): number {
  return ((angle % TAU) + TAU) % TAU;
}

/** Quantize an angle into equal radial sectors and return it in [-pi, pi]. */
export function snapAngle(angle: number, segments: number): number {
  if (!Number.isFinite(angle) || !Number.isFinite(segments) || segments <= 0) {
    return angle;
  }
  const segment = TAU / segments;
  let snapped =
    (Math.floor((clampRadians(angle) + segment / 2) / segment) * segment) % TAU;
  if (snapped > Math.PI) snapped -= TAU;
  return Object.is(snapped, -0) ? 0 : snapped;
}

/** Shortest signed angular displacement from `from` to `to`. */
export function shortAngleDist(from: number, to: number): number {
  return ((((to - from + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
}
