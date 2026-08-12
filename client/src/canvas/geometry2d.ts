// Analytical 2D geometry used for hit-testing, marquee selection, and distance
// queries. Each shape's geometry is expressed in that shape's LOCAL space; the
// caller maps a world point into local space (via `Mat.invert()`) before
// querying, so rotation and scale never have to be baked into these classes.
//
// Built on the primitives in @whiteboard/shared rather than re-deriving them.

import {
  type Bounds,
  type Vec,
  distance,
  pointInPolygon,
  pointsBounds,
} from '@whiteboard/shared';

/** Nearest point to `p` on the segment `a`-`b` (clamped to the segment). */
export function nearestPointOnSegment(p: Vec, a: Vec, b: Vec): Vec {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { x: a.x, y: a.y };
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return { x: a.x + t * dx, y: a.y + t * dy };
}

/**
 * Separating Axis Theorem test for two polygons.
 *
 * Exact for convex polygons. For a non-convex polygon it is conservative: it
 * can report an intersection that does not exist, but never misses a real one.
 * That is the right bias for selection, where the fine hit test runs after.
 */
export function polygonsIntersect(a: readonly Vec[], b: readonly Vec[]): boolean {
  if (a.length === 0 || b.length === 0) return false;

  for (const polygon of [a, b]) {
    for (let i = 0; i < polygon.length; i++) {
      const p1 = polygon[i]!;
      const p2 = polygon[(i + 1) % polygon.length]!;

      // Normal of this edge — a candidate separating axis. Left un-normalized:
      // the overlap comparison is scale-invariant, so the sqrt is wasted work.
      const nx = -(p2.y - p1.y);
      const ny = p2.x - p1.x;
      if (nx === 0 && ny === 0) continue;

      let minA = Infinity;
      let maxA = -Infinity;
      for (const p of a) {
        const proj = nx * p.x + ny * p.y;
        if (proj < minA) minA = proj;
        if (proj > maxA) maxA = proj;
      }

      let minB = Infinity;
      let maxB = -Infinity;
      for (const p of b) {
        const proj = nx * p.x + ny * p.y;
        if (proj < minB) minB = proj;
        if (proj > maxB) maxB = proj;
      }

      if (maxA < minB || maxB < minA) return false; // separating axis found
    }
  }
  return true;
}

/** True if segment `a`-`b` intersects segment `c`-`d` (proper or touching). */
export function segmentsIntersect(a: Vec, b: Vec, c: Vec, d: Vec): boolean {
  const cross = (p: Vec, q: Vec, r: Vec) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }

  // Collinear touching cases.
  const onSegment = (p: Vec, q: Vec, r: Vec) =>
    Math.min(p.x, q.x) <= r.x &&
    r.x <= Math.max(p.x, q.x) &&
    Math.min(p.y, q.y) <= r.y &&
    r.y <= Math.max(p.y, q.y);

  if (d1 === 0 && onSegment(c, d, a)) return true;
  if (d2 === 0 && onSegment(c, d, b)) return true;
  if (d3 === 0 && onSegment(a, b, c)) return true;
  if (d4 === 0 && onSegment(a, b, d)) return true;
  return false;
}

export interface Geometry2dOptions {
  /** A filled shape is hit anywhere inside it, not just near its outline. */
  isFilled?: boolean;
}

export abstract class Geometry2d {
  /** Hit anywhere inside the outline, rather than only near the outline. */
  readonly isFilled: boolean;
  /** A closed geometry's last vertex connects back to its first. */
  abstract readonly isClosed: boolean;

  private cachedVertices: Vec[] | undefined;
  private cachedBounds: Bounds | undefined;

  constructor(options: Geometry2dOptions = {}) {
    this.isFilled = options.isFilled ?? false;
  }

  /** Outline vertices in local space. Curves return a polygonal approximation. */
  protected abstract computeVertices(): Vec[];

  getVertices(): Vec[] {
    this.cachedVertices ??= this.computeVertices();
    return this.cachedVertices;
  }

  /** Closest point on the geometry's outline to `point`. */
  abstract nearestPoint(point: Vec): Vec;

  /**
   * Distance from `point` to the geometry: 0 when the point is inside a filled
   * shape, otherwise the distance to the outline.
   */
  distanceToPoint(point: Vec): number {
    if (this.isFilled && this.isClosed && pointInPolygon(point, this.getVertices())) {
      return 0;
    }
    return distance(point, this.nearestPoint(point));
  }

  /** `margin` is a world-space tolerance, normally a screen threshold / zoom. */
  hitTestPoint(point: Vec, margin = 0): boolean {
    return this.distanceToPoint(point) <= margin;
  }

  getBounds(): Bounds {
    this.cachedBounds ??= pointsBounds(this.getVertices());
    return this.cachedBounds;
  }

  /**
   * True when `polygon` (e.g. a marquee rectangle) overlaps this geometry.
   * A closed geometry uses SAT on its outline; an open one additionally
   * reports a crossing of any of its segments.
   */
  intersectsPolygon(polygon: readonly Vec[]): boolean {
    const vertices = this.getVertices();
    if (this.isClosed) return polygonsIntersect(vertices, polygon);

    for (const v of vertices) {
      if (pointInPolygon(v, polygon)) return true;
    }
    for (let i = 0; i < vertices.length - 1; i++) {
      const a = vertices[i]!;
      const b = vertices[i + 1]!;
      for (let j = 0; j < polygon.length; j++) {
        const c = polygon[j]!;
        const d = polygon[(j + 1) % polygon.length]!;
        if (segmentsIntersect(a, b, c, d)) return true;
      }
    }
    return false;
  }
}

/** Axis-aligned rectangle in local space. */
export class Rectangle2d extends Geometry2d {
  readonly isClosed = true;

  constructor(
    readonly x: number,
    readonly y: number,
    readonly w: number,
    readonly h: number,
    options: Geometry2dOptions = {},
  ) {
    super(options);
  }

  protected computeVertices(): Vec[] {
    const { x, y, w, h } = this;
    return [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ];
  }

  nearestPoint(point: Vec): Vec {
    const vertices = this.getVertices();
    let best: Vec | undefined;
    let bestDist = Infinity;
    for (let i = 0; i < vertices.length; i++) {
      const candidate = nearestPointOnSegment(
        point,
        vertices[i]!,
        vertices[(i + 1) % vertices.length]!,
      );
      const d = distance(point, candidate);
      if (d < bestDist) {
        bestDist = d;
        best = candidate;
      }
    }
    return best ?? { x: this.x, y: this.y };
  }
}

/** Circle centered at (x, y) with radius r. */
export class Circle2d extends Geometry2d {
  readonly isClosed = true;

  /** Segments used when a polygonal approximation is needed (bounds, SAT). */
  private static readonly SEGMENTS = 24;

  constructor(
    readonly x: number,
    readonly y: number,
    readonly r: number,
    options: Geometry2dOptions = {},
  ) {
    super(options);
  }

  protected computeVertices(): Vec[] {
    const out: Vec[] = [];
    for (let i = 0; i < Circle2d.SEGMENTS; i++) {
      const theta = (i / Circle2d.SEGMENTS) * Math.PI * 2;
      out.push({
        x: this.x + Math.cos(theta) * this.r,
        y: this.y + Math.sin(theta) * this.r,
      });
    }
    return out;
  }

  nearestPoint(point: Vec): Vec {
    const dx = point.x - this.x;
    const dy = point.y - this.y;
    const len = Math.hypot(dx, dy);
    // At the exact center every boundary point is equidistant; pick one.
    if (len === 0) return { x: this.x + this.r, y: this.y };
    return { x: this.x + (dx / len) * this.r, y: this.y + (dy / len) * this.r };
  }

  /** Exact, rather than going through the polygonal approximation. */
  override distanceToPoint(point: Vec): number {
    const distToCenter = Math.hypot(point.x - this.x, point.y - this.y);
    return this.isFilled
      ? Math.max(0, distToCenter - this.r)
      : Math.abs(distToCenter - this.r);
  }

  override getBounds(): Bounds {
    return {
      minX: this.x - this.r,
      minY: this.y - this.r,
      maxX: this.x + this.r,
      maxY: this.y + this.r,
    };
  }
}

/** Closed ring of vertices — convex or not. */
export class Polygon2d extends Geometry2d {
  readonly isClosed = true;

  constructor(
    private readonly points: readonly Vec[],
    options: Geometry2dOptions = {},
  ) {
    super(options);
  }

  protected computeVertices(): Vec[] {
    return this.points.map((p) => ({ x: p.x, y: p.y }));
  }

  nearestPoint(point: Vec): Vec {
    const vertices = this.getVertices();
    const first = vertices[0];
    if (!first) return { x: point.x, y: point.y };
    if (vertices.length === 1) return first;

    let best = first;
    let bestDist = Infinity;
    // The closing edge (last -> first) is what makes this a ring.
    for (let i = 0; i < vertices.length; i++) {
      const candidate = nearestPointOnSegment(
        point,
        vertices[i]!,
        vertices[(i + 1) % vertices.length]!,
      );
      const d = distance(point, candidate);
      if (d < bestDist) {
        bestDist = d;
        best = candidate;
      }
    }
    return best;
  }
}

/** Open chain of vertices (a line, arrow spine, or freehand stroke). */
export class Polyline2d extends Geometry2d {
  readonly isClosed = false;

  constructor(private readonly points: readonly Vec[]) {
    // An open chain has no interior, so it is never filled.
    super({ isFilled: false });
  }

  protected computeVertices(): Vec[] {
    return this.points.map((p) => ({ x: p.x, y: p.y }));
  }

  nearestPoint(point: Vec): Vec {
    const vertices = this.getVertices();
    const first = vertices[0];
    if (!first) return { x: point.x, y: point.y };
    if (vertices.length === 1) return first;

    let best = first;
    let bestDist = Infinity;
    for (let i = 0; i < vertices.length - 1; i++) {
      const candidate = nearestPointOnSegment(point, vertices[i]!, vertices[i + 1]!);
      const d = distance(point, candidate);
      if (d < bestDist) {
        bestDist = d;
        best = candidate;
      }
    }
    return best;
  }
}
