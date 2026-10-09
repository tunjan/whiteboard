import { describe, expect, it } from 'vitest';
import { type Curve, curveCrossings } from './construction-snap';

const circle = (x: number, y: number, r: number): Curve => ({
  kind: 'circle',
  c: { x, y },
  r,
  bounds: { minX: x - r, minY: y - r, maxX: x + r, maxY: y + r },
});
const seg = (ax: number, ay: number, bx: number, by: number): Curve => ({
  kind: 'path',
  segs: [[{ x: ax, y: ay }, { x: bx, y: by }]],
  bounds: {
    minX: Math.min(ax, bx),
    minY: Math.min(ay, by),
    maxX: Math.max(ax, bx),
    maxY: Math.max(ay, by),
  },
});
const sorted = (points: { x: number; y: number }[]) =>
  points
    .map((p) => [Math.round(p.x * 1e6) / 1e6, Math.round(p.y * 1e6) / 1e6])
    .sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!);

describe('curveCrossings', () => {
  it('finds both points of the perpendicular-bisector construction', () => {
    // Two circles of radius 100 centred 100 apart meet at x = 50, y = ±50√3.
    const h = 50 * Math.sqrt(3);
    expect(sorted(curveCrossings([circle(0, 0, 100), circle(100, 0, 100)]))).toEqual(
      sorted([
        { x: 50, y: -h },
        { x: 50, y: h },
      ]),
    );
  });

  it('meets a segment with a circle and with another segment', () => {
    expect(sorted(curveCrossings([circle(0, 0, 10), seg(-20, 0, 20, 0)]))).toEqual([
      [-10, 0],
      [10, 0],
    ]);
    expect(sorted(curveCrossings([seg(0, 0, 10, 10), seg(0, 10, 10, 0)]))).toEqual([
      [5, 5],
    ]);
  });

  it('reports nothing for circles apart, nested, or segments that stop short', () => {
    expect(curveCrossings([circle(0, 0, 10), circle(50, 0, 10)])).toEqual([]);
    expect(curveCrossings([circle(0, 0, 50), circle(5, 0, 10)])).toEqual([]);
    expect(curveCrossings([seg(0, 0, 4, 4), seg(0, 10, 10, 0)])).toEqual([]);
  });
});
