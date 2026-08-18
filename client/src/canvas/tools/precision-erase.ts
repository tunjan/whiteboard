import {
  type Bounds,
  type DrawPoint,
  type Point,
  type Shape,
  type Vec,
  boundsIntersect,
  pointsBounds,
  rotatePoint,
} from '@whiteboard/shared';
import { curvePoints } from '../shapes/line-geometry';
import { cutPolyline } from './cut-polyline';

/**
 * Cutting shapes with the precision eraser.
 *
 * Only the two polyline-backed types can be cut: `draw`, whose stored points are
 * the ink itself, and `line`, whose visible curve flattens to a polyline. Every
 * other type is parametric or composite and has no meaningful "half", so the
 * eraser deletes those whole — see the tool for that branch.
 *
 * A cut is accumulated as a list of surviving *runs* in the shape's local frame,
 * one swipe segment at a time, and only written to the document when the stroke
 * ends. The shape in the document is untouched until then, so the runs are always
 * measured against the original geometry.
 */

/** Surviving points of one fragment, in the shape's local frame. */
export type PointRun = DrawPoint[];

/** Fudge added to a stroke's half-width, matching the eraser's targeting rule. */
function cutRadius(shape: Shape, margin: number): number {
  const size = (shape.props as { size?: number }).size ?? 0;
  return margin + size / 2;
}

function swipeBounds(a: Point, b: Point, pad: number): Bounds {
  return {
    minX: Math.min(a.x, b.x) - pad,
    minY: Math.min(a.y, b.y) - pad,
    maxX: Math.max(a.x, b.x) + pad,
    maxY: Math.max(a.y, b.y) + pad,
  };
}

function expand(b: Bounds, m: number): Bounds {
  return { minX: b.minX - m, minY: b.minY - m, maxX: b.maxX + m, maxY: b.maxY + m };
}

function lerpPoint(from: DrawPoint, to: DrawPoint, t: number): DrawPoint {
  const point: DrawPoint = {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
  };
  // Only ink carries pressure; a line's boundary point must not gain the key.
  if (from.pressure !== undefined && to.pressure !== undefined) {
    point.pressure = from.pressure + (to.pressure - from.pressure) * t;
  } else if (from.pressure !== undefined) {
    point.pressure = from.pressure;
  }
  return point;
}

/**
 * The polyline a shape's geometry reduces to, or null when it cannot be cut.
 *
 * A line is flattened through the same sampler its renderer and hit-test use, so
 * the cut follows the curve the user sees rather than the two vertices behind it.
 */
export function cuttablePoints(shape: Shape): PointRun | null {
  if (shape.type === 'draw') return shape.props.points;
  if (shape.type === 'line') {
    return curvePoints(
      shape.props.points,
      shape.props.bend ?? 0,
      shape.props.spline ?? 'linear',
    );
  }
  return null;
}

/** Centre of a run's bounds — the point every polyline renderer rotates about. */
function runCentre(points: readonly Point[]): Vec {
  const b = pointsBounds(points);
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

/**
 * Apply one swipe segment to a shape's accumulated runs.
 *
 * Returns `runs` itself when the swipe changed nothing, so a sweep that misses
 * costs no allocation and pushes no new state at the store (which would re-render
 * the shape once per pointer sample).
 */
export function cutRuns(
  shape: Shape,
  runs: readonly PointRun[],
  a: Point,
  b: Point,
  margin: number,
): PointRun[] {
  const original = cuttablePoints(shape);
  if (!original) return runs as PointRun[];
  const r = cutRadius(shape, margin);

  // Into the shape's upright local frame, the same translation the renderer
  // undoes — so a rotated stroke is cut where its ink actually sits. The centre
  // costs a pass over every stored point and is only needed to un-rotate, so an
  // unrotated shape (every stroke the pen makes) never pays for it.
  const centre = shape.rotation ? runCentre(original) : null;
  const toLocal = (p: Point): Point => {
    const up = centre
      ? rotatePoint(p, { x: shape.x + centre.x, y: shape.y + centre.y }, -shape.rotation)
      : p;
    return { x: up.x - shape.x, y: up.y - shape.y };
  };
  const la = toLocal(a);
  const lb = toLocal(b);
  const swipe = swipeBounds(la, lb, r);

  let changed = false;
  const next: PointRun[] = [];
  for (const run of runs) {
    if (run.length === 0) continue;
    if (!boundsIntersect(swipe, expand(pointsBounds(run), r))) {
      next.push(run);
      continue;
    }
    const out = cutPolyline(run, la, lb, r, lerpPoint);
    // Nothing removed and no boundary inserted: keep the original reference.
    if (out.length === 1 && out[0]!.length === run.length) {
      next.push(run);
      continue;
    }
    changed = true;
    for (const fragment of out) next.push(fragment);
  }
  return changed ? next : (runs as PointRun[]);
}

/**
 * Rebuild a surviving run as a shape that renders exactly where that ink was.
 *
 * Both ink and lines rotate about the centre of their own points' bounds, which
 * a fragment no longer shares with its parent, so the fragment's origin has to
 * absorb the difference. With R the rotation by the shape's angle, c the parent's
 * points-centre and c' the fragment's, `x' = x + (c - Rc) - (c' - Rc')` is the
 * origin at which both render the same local point to the same place. For an
 * unrotated shape — every stroke the pen makes — it collapses to `x' = x`.
 */
export function fragmentShape(shape: Shape, run: PointRun, id: string): Shape {
  let x = shape.x;
  let y = shape.y;
  const original = shape.rotation ? cuttablePoints(shape) : null;
  if (original) {
    const origin = { x: 0, y: 0 };
    const c = runCentre(original);
    const rc = rotatePoint(c, origin, shape.rotation);
    const c2 = runCentre(run);
    const rc2 = rotatePoint(c2, origin, shape.rotation);
    x = shape.x + (c.x - rc.x) - (c2.x - rc2.x);
    y = shape.y + (c.y - rc.y) - (c2.y - rc2.y);
  }

  if (shape.type === 'draw') {
    return {
      ...shape,
      id,
      x,
      y,
      // A cut loop no longer encloses a region, so its fill goes with the cut.
      props: { ...shape.props, points: run, isClosed: false },
    };
  }
  if (shape.type === 'line') {
    return {
      ...shape,
      id,
      x,
      y,
      // The run is already the flattened curve, so the fragment stores it as
      // plain vertices; re-curving it would bend the ink a second time. The
      // label is dropped because a fragment has no claim to the whole's caption.
      props: {
        ...shape.props,
        points: run.map((p) => ({ x: p.x, y: p.y })),
        bend: 0,
        spline: 'linear',
        label: '',
      },
    };
  }
  return { ...shape, id };
}
