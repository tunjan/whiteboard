// Analytical 2D geometry used for hit-testing, marquee selection, and distance
// queries. Each shape's geometry is expressed in that shape's LOCAL space; the
// caller un-rotates a world point into local space (see `unrotatedPoint` in
// shapes/box-geometry) before querying, so rotation never has to be baked into
// these classes.
//
// Built on the primitives in @whiteboard/shared rather than re-deriving them.

import {
  type Bounds,
  type Vec,
  closestPointOnSegment,
  distance,
  pointInPolygon,
  pointsBounds,
  segmentsIntersect,
} from '@whiteboard/shared';

/**
 * Closest point to `p` on the polyline through `vertices`. `closed` includes
 * the edge from the last vertex back to the first, which is what turns an open
 * chain into a ring — the only difference between every outline walk here.
 */
function nearestPointOnPath(
  p: Vec,
  vertices: readonly Vec[],
  closed: boolean,
): Vec {
  const first = vertices[0];
  if (!first) return { x: p.x, y: p.y };
  if (vertices.length === 1) return first;

  let best: Vec = first;
  let bestDist = Infinity;
  const edges = closed ? vertices.length : vertices.length - 1;
  for (let i = 0; i < edges; i++) {
    const candidate = closestPointOnSegment(
      p,
      vertices[i]!,
      vertices[(i + 1) % vertices.length]!,
    );
    const d = distance(p, candidate);
    if (d < bestDist) {
      bestDist = d;
      best = candidate;
    }
  }
  return best;
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
    return nearestPointOnPath(point, this.getVertices(), true);
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

/** Axis-aligned ellipse centered at (x, y) with radii rx and ry. */
export class Ellipse2d extends Geometry2d {
  readonly isClosed = true;

  /**
   * Matches the step count `selection-geometry` flattens an ellipse with, so
   * that a click and a marquee agree about where the shape's edge runs.
   */
  private static readonly SEGMENTS = 48;

  constructor(
    readonly x: number,
    readonly y: number,
    readonly rx: number,
    readonly ry: number,
    options: Geometry2dOptions = {},
  ) {
    super(options);
  }

  protected computeVertices(): Vec[] {
    const out: Vec[] = [];
    for (let i = 0; i < Ellipse2d.SEGMENTS; i++) {
      const theta = (i / Ellipse2d.SEGMENTS) * Math.PI * 2;
      out.push({
        x: this.x + Math.cos(theta) * this.rx,
        y: this.y + Math.sin(theta) * this.ry,
      });
    }
    return out;
  }

  nearestPoint(point: Vec): Vec {
    return nearestPointOnPath(point, this.getVertices(), true);
  }

  /** True when `point` lies within the true ellipse, not its approximation. */
  containsPoint(point: Vec): boolean {
    if (this.rx === 0 || this.ry === 0) return false;
    const dx = (point.x - this.x) / this.rx;
    const dy = (point.y - this.y) / this.ry;
    return dx * dx + dy * dy <= 1;
  }

  /**
   * The interior test is exact rather than going through `getVertices()`: the
   * inscribed polygon cuts inside the true outline along every one of its
   * chords, so a point in that sliver would read as outside a filled shape.
   */
  override distanceToPoint(point: Vec): number {
    if (this.isFilled && this.containsPoint(point)) return 0;
    return distance(point, this.nearestPoint(point));
  }

  override getBounds(): Bounds {
    return {
      minX: this.x - this.rx,
      minY: this.y - this.ry,
      maxX: this.x + this.rx,
      maxY: this.y + this.ry,
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
    return nearestPointOnPath(point, this.getVertices(), true);
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
    return nearestPointOnPath(point, this.getVertices(), false);
  }
}
