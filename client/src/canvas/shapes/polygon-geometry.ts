import type { PolygonKind, Vec } from '@whiteboard/shared';

function regular(n: number): Vec[] {
  const pts: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    pts.push({ x: 0.5 + 0.5 * Math.cos(a), y: 0.5 + 0.5 * Math.sin(a) });
  }
  return pts;
}

/** A five-pointed star: points on the unit circle, valleys on a smaller one. */
function star(): Vec[] {
  const pts: Vec[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? 0.5 * 0.382 : 0.5;
    pts.push({ x: 0.5 + r * Math.cos(a), y: 0.5 + r * Math.sin(a) });
  }
  return pts;
}

/** Vertices per cloud bump; every this-many-th vertex is a cusp. */
export const CLOUD_BUMP_SAMPLES = 8;

/**
 * A cloud as a polygon: outward arcs between uneven points on a circle,
 * sampled densely enough that the round join hides the facets, then stretched
 * to fill the unit box. A polygon rather than a path so the fill, the drawn
 * and dashed outlines and the hit test all take it as they take a hexagon.
 */
function cloud(): Vec[] {
  // Uneven spacing gives the bumps different sizes.
  const angles = [-100, -45, 5, 50, 95, 135, 180, 220].map(
    (deg) => (deg * Math.PI) / 180,
  );
  const half = (75 * Math.PI) / 180; // half the angle each bump sweeps
  const steps = CLOUD_BUMP_SAMPLES;
  const pts: Vec[] = [];
  angles.forEach((a0, i) => {
    const a1 = angles[(i + 1) % angles.length]!;
    const p = { x: Math.cos(a0), y: Math.sin(a0) };
    const q = { x: Math.cos(a1), y: Math.sin(a1) };
    const m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    const chord = Math.hypot(q.x - p.x, q.y - p.y);
    const len = Math.hypot(m.x, m.y);
    const n = { x: m.x / len, y: m.y / len };
    const r = chord / 2 / Math.sin(half);
    const c = { x: m.x - n.x * r * Math.cos(half), y: m.y - n.y * r * Math.cos(half) };
    const start = Math.atan2(p.y - c.y, p.x - c.x);
    let sweep = Math.atan2(q.y - c.y, q.x - c.x) - start;
    if (sweep > Math.PI) sweep -= 2 * Math.PI;
    if (sweep < -Math.PI) sweep += 2 * Math.PI;
    for (let j = 0; j < steps; j++) {
      const t = start + (sweep * j) / steps;
      pts.push({ x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) });
    }
  });
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const w = Math.max(...xs) - minX;
  const h = Math.max(...ys) - minY;
  return pts.map((p) => ({ x: (p.x - minX) / w, y: (p.y - minY) / h }));
}

const CLOUD = cloud();
const STAR = star();

/** Polygon vertices normalized to the unit box [0,1] x [0,1]. */
export function normalizedPolygonPoints(kind: PolygonKind): Vec[] {
  switch (kind) {
    case 'triangle':
      return [
        { x: 0.5, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ];
    case 'diamond':
      return [
        { x: 0.5, y: 0 },
        { x: 1, y: 0.5 },
        { x: 0.5, y: 1 },
        { x: 0, y: 0.5 },
      ];
    case 'parallelogram':
      return [
        { x: 0.25, y: 0 },
        { x: 1, y: 0 },
        { x: 0.75, y: 1 },
        { x: 0, y: 1 },
      ];
    case 'trapezoid':
      return [
        { x: 0.25, y: 0 },
        { x: 0.75, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ];
    case 'pentagon':
      return regular(5);
    case 'hexagon':
      return regular(6);
    case 'cloud':
      return CLOUD;
    case 'star':
      return STAR;
  }
}

/** Polygon vertices placed in a world-space box. */
export function polygonVerticesForBox(
  kind: PolygonKind,
  x: number,
  y: number,
  w: number,
  h: number,
): Vec[] {
  return normalizedPolygonPoints(kind).map((p) => ({
    x: x + p.x * w,
    y: y + p.y * h,
  }));
}

/** SVG `points` attribute for a polygon placed in a world-space box. */
export function polygonPointsForBox(
  kind: PolygonKind,
  x: number,
  y: number,
  w: number,
  h: number,
): string {
  return polygonVerticesForBox(kind, x, y, w, h)
    .map((p) => `${p.x},${p.y}`)
    .join(' ');
}
