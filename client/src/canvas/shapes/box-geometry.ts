import { type Bounds, type Point, rotatePoint } from '@whiteboard/shared';

// Shared geometry for box-like shapes (rectangle, ellipse, and later image,
// equation card, ...). They differ only in how they render and, eventually,
// hit-test their interior.

export function boxBounds(x: number, y: number, w: number, h: number): Bounds {
  return { minX: x, minY: y, maxX: x + w, maxY: y + h };
}

/** SVG `rotate(...)` transform around the box center, or undefined if upright. */
export function rotationTransform(
  x: number,
  y: number,
  w: number,
  h: number,
  rotation: number,
): string | undefined {
  if (!rotation) return undefined;
  const cx = x + w / 2;
  const cy = y + h / 2;
  return `rotate(${(rotation * 180) / Math.PI} ${cx} ${cy})`;
}

/** Bounding-box hit test, accounting for the shape's rotation. */
export function boxHitTest(
  x: number,
  y: number,
  w: number,
  h: number,
  rotation: number,
  p: Point,
  tolerance: number,
): boolean {
  const center = { x: x + w / 2, y: y + h / 2 };
  const local = rotation ? rotatePoint(p, center, -rotation) : p;
  return (
    local.x >= x - tolerance &&
    local.x <= x + w + tolerance &&
    local.y >= y - tolerance &&
    local.y <= y + h + tolerance
  );
}
