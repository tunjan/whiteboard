import {
  type Bounds,
  type Point,
  type Vec,
  distance,
  distanceToSegment,
  pointsBounds,
  rotatePoint,
} from '@whiteboard/shared';

// Shared geometry for polyline shapes (line, arrow, and later connectors).
// Points are in shape-local coordinates relative to (x, y).

export function polylineBounds(
  x: number,
  y: number,
  points: readonly Vec[],
  pad: number,
): Bounds {
  const b = pointsBounds(points);
  return {
    minX: x + b.minX - pad,
    minY: y + b.minY - pad,
    maxX: x + b.maxX + pad,
    maxY: y + b.maxY + pad,
  };
}

export function polylineHitTest(
  x: number,
  y: number,
  rotation: number,
  points: readonly Vec[],
  p: Point,
  tolerance: number,
  sizeHalf: number,
): boolean {
  if (points.length === 0) return false;
  const b = pointsBounds(points);
  const center = { x: x + (b.minX + b.maxX) / 2, y: y + (b.minY + b.maxY) / 2 };
  const wp = rotation ? rotatePoint(p, center, -rotation) : p;
  const local = { x: wp.x - x, y: wp.y - y };
  const r = tolerance + sizeHalf;
  if (points.length === 1) return distance(local, points[0]!) <= r;
  for (let i = 0; i < points.length - 1; i++) {
    if (distanceToSegment(local, points[i]!, points[i + 1]!) <= r) return true;
  }
  return false;
}

/** SVG transform for a polyline shape (translate + optional rotation). */
export function polylineTransform(
  x: number,
  y: number,
  points: readonly Vec[],
  rotation: number,
): string {
  let t = `translate(${x} ${y})`;
  if (rotation) {
    const b = pointsBounds(points);
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    t += ` rotate(${(rotation * 180) / Math.PI} ${cx} ${cy})`;
  }
  return t;
}

/** SVG path "d" for the connecting polyline through `points`. */
export function polylinePath(points: readonly Vec[]): string {
  return points.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ');
}

// --- Quadratic-curve connectors -------------------------------------------
// A connector is a 2-vertex polyline that can bow into a quadratic arc. `bend`
// is the signed perpendicular distance (local units) from the chord midpoint to
// the visible apex of the curve. Endpoints are points[0] and points[last].

const BEND_EPSILON = 0.5;

/** Unit perpendicular to the chord a→b (rotated +90°). */
function chordPerp(a: Vec, b: Vec): Vec {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: -dy / len, y: dx / len };
}

/** Quadratic control point so the curve's apex sits at midpoint + perp*bend. */
export function controlPoint(a: Vec, b: Vec, bend: number): Vec {
  const n = chordPerp(a, b);
  // Q(0.5) = M/2 + P1/2, so P1 = M + 2*perp*bend places the apex at M + perp*bend.
  return { x: (a.x + b.x) / 2 + n.x * 2 * bend, y: (a.y + b.y) / 2 + n.y * 2 * bend };
}

/** World/local position of the draggable bend handle (the curve's apex). */
export function curveApex(a: Vec, b: Vec, bend: number): Vec {
  const n = chordPerp(a, b);
  return { x: (a.x + b.x) / 2 + n.x * bend, y: (a.y + b.y) / 2 + n.y * bend };
}

/** Signed bend implied by dragging the apex to `p`. */
export function bendFromPoint(a: Vec, b: Vec, p: Vec): number {
  const n = chordPerp(a, b);
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  return (p.x - mx) * n.x + (p.y - my) * n.y;
}

/** Sample the connector into a polyline (curve flattened) for bounds/hit-test. */
export function curvePoints(points: readonly Vec[], bend: number): Vec[] {
  if (points.length < 2 || Math.abs(bend) < BEND_EPSILON) {
    return points as Vec[];
  }
  const a = points[0]!;
  const b = points[points.length - 1]!;
  const c = controlPoint(a, b, bend);
  const segments = 24;
  const out: Vec[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const mt = 1 - t;
    out.push({
      x: mt * mt * a.x + 2 * mt * t * c.x + t * t * b.x,
      y: mt * mt * a.y + 2 * mt * t * c.y + t * t * b.y,
    });
  }
  return out;
}

/** SVG path for the connector: straight when flat, quadratic when bent. */
export function curvePath(points: readonly Vec[], bend: number): string {
  if (points.length < 2) return '';
  if (Math.abs(bend) < BEND_EPSILON) return polylinePath(points);
  const a = points[0]!;
  const b = points[points.length - 1]!;
  const c = controlPoint(a, b, bend);
  return `M ${a.x} ${a.y} Q ${c.x} ${c.y} ${b.x} ${b.y}`;
}

/**
 * Point the arrowhead at `end` should aim away from — the curve's tangent
 * anchor. For a straight line this is the other endpoint; for a curve it is the
 * control point, so the head follows the tangent.
 */
export function tangentAnchor(
  points: readonly Vec[],
  bend: number,
  atStart: boolean,
): Vec {
  const a = points[0]!;
  const b = points[points.length - 1]!;
  if (Math.abs(bend) < BEND_EPSILON) return atStart ? b : a;
  return controlPoint(a, b, bend);
}

/**
 * Scale a polyline's points to fit `newBounds`, returning the new origin,
 * points, and the average scale factor (used to scale a connector's bend).
 */
export function resizePolyline(
  points: readonly Vec[],
  pad: number,
  nb: Bounds,
): { x: number; y: number; points: Vec[]; scale: number } {
  const pb0 = pointsBounds(points);
  const iw = pb0.maxX - pb0.minX + 2 * pad || 1;
  const ih = pb0.maxY - pb0.minY + 2 * pad || 1;
  const sx = (nb.maxX - nb.minX) / iw;
  const sy = (nb.maxY - nb.minY) / ih;
  const scaled = points.map((p) => ({ x: p.x * sx, y: p.y * sy }));
  const pb = pointsBounds(scaled);
  return {
    x: nb.minX - (pb.minX - pad),
    y: nb.minY - (pb.minY - pad),
    points: scaled,
    scale: (sx + sy) / 2,
  };
}

/** Length (world units) of the arrowhead barbs for a given stroke width. */
export function arrowheadLength(size: number): number {
  return Math.max(8, size * 3.5);
}

/** Open-V arrowhead path with its tip at `to`, pointing away from `from`. */
export function arrowheadPath(from: Vec, to: Vec, size: number): string {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const len = arrowheadLength(size);
  const spread = Math.PI / 7;
  const b1 = {
    x: to.x - len * Math.cos(angle - spread),
    y: to.y - len * Math.sin(angle - spread),
  };
  const b2 = {
    x: to.x - len * Math.cos(angle + spread),
    y: to.y - len * Math.sin(angle + spread),
  };
  return `M ${b1.x} ${b1.y} L ${to.x} ${to.y} L ${b2.x} ${b2.y}`;
}
