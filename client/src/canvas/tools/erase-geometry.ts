import {
  type Bounds,
  type Point,
  type Shape,
  boundsCenter,
  boundsIntersect,
  distanceToSegment,
  pointInPolygon,
  pointsBounds,
  rotatePoint,
  segmentToSegmentDistance,
} from '@whiteboard/shared';
import { curvePoints } from '../shapes/line-geometry';
import { normalizedPolygonPoints } from '../shapes/polygon-geometry';
import type { ShapeUtil } from '../shapes/types';

// Collision math for the swipe eraser. The eraser tests the *segment* between
// the pointer's previous and current position (not a single point), translated
// into each candidate shape's local, unrotated frame so the geometry below can
// treat the shape as upright. The narrow tests are reused across the whole erase
// stroke, so they stay allocation-light.

/**
 * Shortest distance from segment a-b to a polyline. `closed` adds the edge that
 * joins the last vertex back to the first (for shape outlines).
 */
function segPolylineDistance(
  a: Point,
  b: Point,
  pts: readonly Point[],
  closed: boolean,
): number {
  const n = pts.length;
  if (n === 0) return Infinity;
  if (n === 1) return distanceToSegment(pts[0]!, a, b);
  let min = Infinity;
  const edges = closed ? n : n - 1;
  for (let i = 0; i < edges; i++) {
    const d = segmentToSegmentDistance(a, b, pts[i]!, pts[(i + 1) % n]!);
    if (d < min) min = d;
    if (min === 0) return 0;
  }
  return min;
}

/** Axis-aligned bounds of the swipe segment, padded by the collision margin. */
function segmentBounds(a: Point, b: Point, pad: number): Bounds {
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

function boxCorners(b: Bounds): Point[] {
  return [
    { x: b.minX, y: b.minY },
    { x: b.maxX, y: b.minY },
    { x: b.maxX, y: b.maxY },
    { x: b.minX, y: b.maxY },
  ];
}

function pointInBounds(p: Point, b: Bounds): boolean {
  return p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;
}

function ellipsePerimeter(b: Bounds, steps = 32): Point[] {
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const rx = (b.maxX - b.minX) / 2;
  const ry = (b.maxY - b.minY) / 2;
  const out: Point[] = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    out.push({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) });
  }
  return out;
}

function insideEllipse(p: Point, b: Bounds): boolean {
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const rx = (b.maxX - b.minX) / 2 || 1;
  const ry = (b.maxY - b.minY) / 2 || 1;
  const nx = (p.x - cx) / rx;
  const ny = (p.y - cy) / ry;
  return nx * nx + ny * ny <= 1;
}

function polygonCorners(b: Bounds, kind: Parameters<typeof normalizedPolygonPoints>[0]): Point[] {
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  return normalizedPolygonPoints(kind).map((v) => ({
    x: b.minX + v.x * w,
    y: b.minY + v.y * h,
  }));
}

/** Un-rotate a point into a shape's upright local frame around `center`. */
function toLocal(p: Point, center: Point, rotation: number): Point {
  return rotation ? rotatePoint(p, center, -rotation) : p;
}

/**
 * Does the swipe segment a-b erase `shape`? Both points are translated into the
 * shape's local frame, then matched against a geometry-specific rule:
 *
 * - Filled shapes (`fillStyle` set, or always-opaque text/image) register a
 *   hit anywhere on or inside their outline.
 * - Hollow shapes register a hit only when the swipe passes within `margin` of
 *   the stroked outline itself.
 * - Polyline shapes (draw/line/arrow) hit when the swipe comes within
 *   `margin + halfStroke` of the stroke path.
 *
 * `margin` is the zoom-scaled collision radius in world units.
 */
export function segmentErasesShape(
  shape: Shape,
  util: ShapeUtil,
  a: Point,
  b: Point,
  margin: number,
): boolean {
  switch (shape.type) {
    case 'draw': {
      const pts = shape.props.points;
      if (pts.length === 0) return false;
      const r = margin + shape.props.size / 2;
      const pb = pointsBounds(pts);
      const center = { x: shape.x + (pb.minX + pb.maxX) / 2, y: shape.y + (pb.minY + pb.maxY) / 2 };
      const la = sub(toLocal(a, center, shape.rotation), shape);
      const lb = sub(toLocal(b, center, shape.rotation), shape);
      if (!boundsIntersect(segmentBounds(la, lb, r), expand(pb, r))) return false;
      return segPolylineDistance(la, lb, pts, shape.props.isClosed) <= r;
    }
    case 'line':
    case 'arrow': {
      const pts = curvePoints(shape.props.points, shape.props.bend ?? 0);
      if (pts.length === 0) return false;
      const r = margin + shape.props.size / 2;
      const pb = pointsBounds(pts);
      const center = { x: shape.x + (pb.minX + pb.maxX) / 2, y: shape.y + (pb.minY + pb.maxY) / 2 };
      const la = sub(toLocal(a, center, shape.rotation), shape);
      const lb = sub(toLocal(b, center, shape.rotation), shape);
      if (!boundsIntersect(segmentBounds(la, lb, r), expand(pb, r))) return false;
      return segPolylineDistance(la, lb, pts, false) <= r;
    }
    default: {
      // Box-like shapes: rectangle, ellipse, polygon, image, text.
      const box = util.getBounds(shape);
      const center = boundsCenter(box);
      const la = toLocal(a, center, shape.rotation);
      const lb = toLocal(b, center, shape.rotation);
      const props = shape.props as { fillStyle?: string; size?: number };
      const r = margin + (props.size ?? 0) / 2;
      if (!boundsIntersect(segmentBounds(la, lb, r), expand(box, r))) return false;
      // text/image have no fillStyle and are always opaque.
      const filled = props.fillStyle ? props.fillStyle !== 'none' : true;

      if (shape.type === 'ellipse') {
        if (segPolylineDistance(la, lb, ellipsePerimeter(box), true) <= r) return true;
        return filled && (insideEllipse(la, box) || insideEllipse(lb, box));
      }
      if (shape.type === 'polygon') {
        const corners = polygonCorners(box, shape.props.kind);
        if (segPolylineDistance(la, lb, corners, true) <= r) return true;
        return filled && (pointInPolygon(la, corners) || pointInPolygon(lb, corners));
      }
      // Rectangle / text / image.
      if (segPolylineDistance(la, lb, boxCorners(box), true) <= r) return true;
      return filled && (pointInBounds(la, box) || pointInBounds(lb, box));
    }
  }
}

/** Translate a local (un-rotated) point into a shape's origin-relative frame. */
function sub(p: Point, origin: { x: number; y: number }): Point {
  return { x: p.x - origin.x, y: p.y - origin.y };
}

/**
 * Does segment a-b touch the axis-aligned box `b`? Liang–Barsky slab clipping:
 * the segment is parameterised as a + t·(b-a) and each axis contributes the
 * interval of `t` for which the point lies between that axis' slab walls. The
 * segment enters the box exactly when those intervals overlap, so the whole
 * test is two interval intersections and no allocation.
 *
 * Used for the frame clip mask, where "does the swipe reach inside this frame"
 * is the question and the exact crossing point is not needed.
 */
export function segmentIntersectsBounds(a: Point, b: Point, box: Bounds): boolean {
  let t0 = 0;
  let t1 = 1;
  for (const axis of ['x', 'y'] as const) {
    const d = b[axis] - a[axis];
    const min = axis === 'x' ? box.minX : box.minY;
    const max = axis === 'x' ? box.maxX : box.maxY;
    if (d === 0) {
      // Parallel to this pair of walls: inside them, or it never enters.
      if (a[axis] < min || a[axis] > max) return false;
      continue;
    }
    const enter = (min - a[axis]) / d;
    const exit = (max - a[axis]) / d;
    t0 = Math.max(t0, Math.min(enter, exit));
    t1 = Math.min(t1, Math.max(enter, exit));
    if (t0 > t1) return false;
  }
  return true;
}
