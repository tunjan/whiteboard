import type { Point } from '@whiteboard/shared';

const EPSILON = 1e-9;
const cross = (a: Point, b: Point, p: Point) =>
  (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);

/** Sutherland–Hodgman intersection; frame masks are always convex. */
export function intersectConvexPolygons(
  subject: readonly Point[],
  clip: readonly Point[],
): Point[] {
  if (subject.length < 3 || clip.length < 3) return [];
  let area = 0;
  for (let i = 0; i < clip.length; i++) {
    const a = clip[i]!,
      b = clip[(i + 1) % clip.length]!;
    area += a.x * b.y - b.x * a.y;
  }
  if (Math.abs(area) < EPSILON) return [];
  const winding = Math.sign(area);
  let output = [...subject];
  for (let i = 0; i < clip.length && output.length; i++) {
    const a = clip[i]!,
      b = clip[(i + 1) % clip.length]!;
    const input = output;
    output = [];
    let previous = input[input.length - 1]!;
    let pd = winding * cross(a, b, previous);
    for (const point of input) {
      const d = winding * cross(a, b, point);
      if (d >= -EPSILON !== pd >= -EPSILON) {
        const t = pd / (pd - d);
        output.push({
          x: previous.x + (point.x - previous.x) * t,
          y: previous.y + (point.y - previous.y) * t,
        });
      }
      if (d >= -EPSILON) output.push(point);
      previous = point;
      pd = d;
    }
  }
  return output.length >= 3 ? output : [];
}

/** null = no mask; [] = fully clipped, never an unclipped fallback. */
export function polygonCss(points: readonly Point[] | null): string {
  if (points === null) return 'none';
  if (points.length < 3) return 'polygon(0px 0px,0px 0px,0px 0px)';
  return `polygon(${points.map((p) => `${p.x}px ${p.y}px`).join(',')})`;
}
