// Core 2D geometry primitives shared by client and server. The client's camera
// math and spatial index build on these (single source of truth).

export interface Vec {
  x: number;
  y: number;
}

/** A point is just a vector. */
export type Point = Vec;

/** Axis-aligned rectangle as top-left + size. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Axis-aligned bounds as min/max (the form rbush uses). */
export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function boxToBounds(b: Box): Bounds {
  return { minX: b.x, minY: b.y, maxX: b.x + b.w, maxY: b.y + b.h };
}

export function boundsToBox(b: Bounds): Box {
  return { x: b.minX, y: b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY };
}

export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return (
    a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY
  );
}

export function boundsContainsPoint(b: Bounds, p: Point): boolean {
  return p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;
}

export function unionBounds(a: Bounds, b: Bounds): Bounds {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export function boundsCenter(b: Bounds): Point {
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

/** Tight bounds of a set of points; returns a zero-area box at origin if empty. */
export function pointsBounds(points: readonly Point[]): Bounds {
  const first = points[0];
  if (!first) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = first.x;
  let minY = first.y;
  let maxX = first.x;
  let maxY = first.y;
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (!p) continue;
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/** Rotate point `p` around `center` by `angle` radians. */
export function rotatePoint(p: Point, center: Point, angle: number): Point {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Shortest distance from point `p` to the segment `a`-`b`. */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return distance(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}

/** Point on segment `a`-`b` closest to `p`. Returns `a` for a degenerate segment. */
export function closestPointOnSegment(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { x: a.x, y: a.y };
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

/** Orientation sign of the triplet (a, b, p): >0 ccw, <0 cw, 0 collinear. */
function orientation(a: Point, b: Point, p: Point): number {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}

/** Is `p` inside the bounding box of segment `a`-`b` (used for collinear cases)? */
function withinSegmentBox(p: Point, a: Point, b: Point): boolean {
  return (
    p.x >= Math.min(a.x, b.x) - SEGMENT_EPS &&
    p.x <= Math.max(a.x, b.x) + SEGMENT_EPS &&
    p.y >= Math.min(a.y, b.y) - SEGMENT_EPS &&
    p.y <= Math.max(a.y, b.y) + SEGMENT_EPS
  );
}

const SEGMENT_EPS = 1e-8;

/**
 * Do segments `a`-`b` and `c`-`d` intersect? Proper crossings are detected by
 * opposing orientations; collinear touches (an endpoint resting exactly on the
 * other segment) are handled by the bounding-box checks.
 *
 * Callers that only need "do these overlap at all" — the marquee, the eraser —
 * share this so the same two segments never get two different answers.
 */
export function segmentsIntersect(
  a: Point,
  b: Point,
  c: Point,
  d: Point,
): boolean {
  const abc = orientation(a, b, c);
  const abd = orientation(a, b, d);
  const cda = orientation(c, d, a);
  const cdb = orientation(c, d, b);
  if ((abc > 0) !== (abd > 0) && (cda > 0) !== (cdb > 0)) return true;
  return (
    (Math.abs(abc) < SEGMENT_EPS && withinSegmentBox(c, a, b)) ||
    (Math.abs(abd) < SEGMENT_EPS && withinSegmentBox(d, a, b)) ||
    (Math.abs(cda) < SEGMENT_EPS && withinSegmentBox(a, c, d)) ||
    (Math.abs(cdb) < SEGMENT_EPS && withinSegmentBox(b, c, d))
  );
}

/** Shortest distance between segments `a`-`b` and `c`-`d` (0 when they meet). */
export function segmentToSegmentDistance(
  a: Point,
  b: Point,
  c: Point,
  d: Point,
): number {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    distanceToSegment(a, c, d),
    distanceToSegment(b, c, d),
    distanceToSegment(c, a, b),
    distanceToSegment(d, a, b),
  );
}

/**
 * Even-odd ray-cast point-in-polygon test. `polygon` is an ordered ring of
 * vertices (implicitly closed); returns true if `p` lies inside it.
 */
export function pointInPolygon(p: Point, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    const intersects =
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}
