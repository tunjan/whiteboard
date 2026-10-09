import { type Bounds, type Point, type Shape, pointsBounds } from '@whiteboard/shared';
import { shapeSnapGeometry } from './snap-geometry';
import { snapRegion, snapTargetShapes } from './snap-targets';
import type { PointSnapTarget } from './snapping';
import type { ToolContext } from './tools/types';

/**
 * A crossing-capable outline: an exact circle (so compass work meets exactly,
 * not on the 64-gon the ellipse snap outline samples), or a run of segments.
 */
export type Curve =
  | { kind: 'circle'; c: Point; r: number; bounds: Bounds }
  | { kind: 'path'; segs: [Point, Point][]; bounds: Bounds };

const EPS = 1e-9;

function curveOf(shape: Shape, target: PointSnapTarget): Curve | null {
  if (
    shape.type === 'ellipse' &&
    Math.abs(shape.props.w - shape.props.h) <= 1e-6 * shape.props.w
  ) {
    const r = shape.props.w / 2;
    const c = { x: shape.x + r, y: shape.y + r };
    return {
      kind: 'circle',
      c,
      r,
      bounds: { minX: c.x - r, minY: c.y - r, maxX: c.x + r, maxY: c.y + r },
    };
  }
  const { outline, closed } = target;
  if (outline.length < 2) return null;
  const segs: [Point, Point][] = [];
  const count = closed ? outline.length : outline.length - 1;
  for (let i = 0; i < count; i++) {
    segs.push([outline[i]!, outline[(i + 1) % outline.length]!]);
  }
  return { kind: 'path', segs, bounds: pointsBounds(outline) };
}

function segSeg(a: Point, b: Point, c: Point, d: Point, out: Point[]): void {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < EPS) return; // parallel or degenerate
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / denom;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / denom;
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return;
  out.push({ x: a.x + t * rx, y: a.y + t * ry });
}

function segCircle(a: Point, b: Point, c: Point, r: number, out: Point[]): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const fx = a.x - c.x;
  const fy = a.y - c.y;
  const A = dx * dx + dy * dy;
  if (A < EPS) return;
  const B = 2 * (fx * dx + fy * dy);
  const C = fx * fx + fy * fy - r * r;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return;
  const root = Math.sqrt(disc);
  for (const t of disc === 0 ? [-B / (2 * A)] : [(-B - root) / (2 * A), (-B + root) / (2 * A)]) {
    if (t >= -EPS && t <= 1 + EPS) out.push({ x: a.x + t * dx, y: a.y + t * dy });
  }
}

function circleCircle(
  c1: Point,
  r1: number,
  c2: Point,
  r2: number,
  out: Point[],
): void {
  const dx = c2.x - c1.x;
  const dy = c2.y - c1.y;
  const d = Math.hypot(dx, dy);
  if (d < EPS || d > r1 + r2 || d < Math.abs(r1 - r2)) return;
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
  const mx = c1.x + (a * dx) / d;
  const my = c1.y + (a * dy) / d;
  out.push({ x: mx + (h * dy) / d, y: my - (h * dx) / d });
  if (h > EPS) out.push({ x: mx - (h * dy) / d, y: my + (h * dx) / d });
}

function overlaps(a: Bounds, b: Bounds): boolean {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}

/** Every point where two of the curves cross. */
export function curveCrossings(curves: readonly Curve[]): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < curves.length; i++) {
    for (let j = i + 1; j < curves.length; j++) {
      const p = curves[i]!;
      const q = curves[j]!;
      if (!overlaps(p.bounds, q.bounds)) continue;
      if (p.kind === 'circle' && q.kind === 'circle') {
        circleCircle(p.c, p.r, q.c, q.r, out);
      } else if (p.kind === 'circle' || q.kind === 'circle') {
        const circle = (p.kind === 'circle' ? p : q) as Extract<Curve, { kind: 'circle' }>;
        const path = (p.kind === 'path' ? p : q) as Extract<Curve, { kind: 'path' }>;
        for (const [a, b] of path.segs) segCircle(a, b, circle.c, circle.r, out);
      } else if (p.kind === 'path' && q.kind === 'path') {
        // ponytail: all segment pairs per overlapping shape pair; fine for
        // straight lines and polygons, add per-segment bounds if smooth
        // splines with hundreds of segments start crowding the viewport.
        for (const [a, b] of p.segs) for (const [c, d] of q.segs) segSeg(a, b, c, d, out);
      }
    }
  }
  return out;
}

/**
 * Snap targets for the straightedge and compass: each visible shape's own snap
 * geometry, plus one extra target holding every point where two outlines
 * cross — constructions are built from those crossings. Collected regardless
 * of the board's snapping preference, since a compass that misses the
 * intersection it was aimed at constructs nothing; Alt still bypasses it.
 */
export function constructionSnapTargets(
  ctx: ToolContext,
  at: Point,
): PointSnapTarget[] {
  const shapes = snapTargetShapes(
    ctx.editor,
    new Set(),
    null,
    snapRegion(ctx, { minX: at.x, minY: at.y, maxX: at.x, maxY: at.y }),
    true,
  );
  const targets: PointSnapTarget[] = [];
  const curves: Curve[] = [];
  for (const shape of shapes) {
    const geometry = shapeSnapGeometry(shape);
    if (!geometry) continue;
    targets.push({ ...geometry, shapeId: shape.id });
    const curve = curveOf(shape, geometry);
    if (curve) curves.push(curve);
  }
  const crossings = curveCrossings(curves);
  if (crossings.length) {
    targets.push({ points: crossings, outline: [], closed: false });
  }
  return targets;
}
