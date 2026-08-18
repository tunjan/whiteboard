import type { PolygonKind, Vec } from '@whiteboard/shared';

function regular(n: number): Vec[] {
  const pts: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    pts.push({ x: 0.5 + 0.5 * Math.cos(a), y: 0.5 + 0.5 * Math.sin(a) });
  }
  return pts;
}

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
