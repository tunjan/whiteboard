import { type Point, distanceToSegment } from '@whiteboard/shared';

/**
 * Ramer–Douglas–Peucker polyline simplification. Removes points that don't
 * meaningfully change the curve, so fast/jagged pointer input collapses to a
 * clean set of points before a stroke renderer consumes it. Preserves any extra
 * fields on each point (e.g. pressure).
 */
export function simplifyRDP<T extends Point>(points: T[], epsilon: number): T[] {
  if (points.length <= 2) return points.slice();

  const first = points[0]!;
  const last = points[points.length - 1]!;

  let maxDist = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = distanceToSegment(points[i]!, first, last);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }

  if (maxDist > epsilon) {
    const left = simplifyRDP(points.slice(0, index + 1), epsilon);
    const right = simplifyRDP(points.slice(index), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [first, last];
}
