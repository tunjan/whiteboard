import { describe, expect, it } from 'vitest';
import type { ArrowShape, Bounds, LineShape } from '@whiteboard/shared';
import { arrowUtil } from './arrow';
import { lineUtil } from './line';
import type { ShapeUtil } from './types';
import {
  arrowPoints,
  arrowheadPath,
  curveApex,
  curvePath,
  curvePoints,
  segmentMidpoint,
} from './line-geometry';

describe('line and arrow geometry', () => {
  it('constructs a circular arc through the visible bend apex', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 120, y: 0 },
    ];
    const bend = 36;
    const sampled = curvePoints(points, bend);
    const middle = sampled[Math.floor(sampled.length / 2)]!;
    const apex = curveApex(points[0]!, points[1]!, bend);

    expect(middle.x).toBeCloseTo(apex.x, 5);
    expect(middle.y).toBeCloseTo(apex.y, 5);
    expect(curvePath(points, bend)).toContain(' A ');
  });

  it('uses a C2 cubic spline that still passes through every source vertex', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 50, y: 80 },
      { x: 110, y: 15 },
      { x: 180, y: 60 },
    ];
    const sampled = curvePoints(points, 0, 'smooth');

    expect(curvePath(points, 0, 'smooth')).toContain(' C ');
    for (const point of points) {
      expect(
        sampled.some(
          (candidate) =>
            Math.abs(candidate.x - point.x) < 1e-7 &&
            Math.abs(candidate.y - point.y) < 1e-7,
        ),
      ).toBe(true);
    }
  });

  it('places create handles on the rendered segment', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 40, y: 80 },
      { x: 100, y: 0 },
    ];
    const midpoint = segmentMidpoint(points, 0, 0, 'smooth');
    expect(midpoint.x).toBeGreaterThan(0);
    expect(midpoint.x).toBeLessThan(40);
    expect(midpoint.y).toBeGreaterThan(0);
  });

  it('normalizes arrow body points for each topology', () => {
    const routed = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 60 },
      { x: 100, y: 60 },
    ];
    expect(arrowPoints(routed, 'straight', 0)).toEqual([routed[0], routed[3]]);
    expect(arrowPoints(routed, 'elbow', 0)).toEqual(routed);
    expect(arrowPoints(routed, 'arc', 30).length).toBeGreaterThan(20);
  });

  it('generates an open arrowhead without invalid coordinates', () => {
    const head = arrowheadPath({ x: 0, y: 0 }, { x: 20, y: 0 }, 4);
    expect(head).not.toContain('NaN');
    expect(head).toContain('M ');
    expect(head).toContain(' L 20 0 L ');
  });
});

describe('connector resizing', () => {
  const base = {
    id: 'c',
    x: 100,
    y: 50,
    rotation: 0,
    index: 'a1',
  };
  const points = [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
  ];
  const line = (props: Partial<LineShape['props']>): LineShape => ({
    ...base,
    type: 'line',
    props: { ...lineUtil.getDefaultProps(), points, size: 2, ...props },
  });
  const arrow = (props: Partial<ArrowShape['props']>): ArrowShape => ({
    ...base,
    type: 'arrow',
    props: { ...arrowUtil.getDefaultProps(), points, size: 2, ...props },
  });

  function expectBounds(actual: Bounds, expected: Bounds) {
    expect(actual.minX).toBeCloseTo(expected.minX, 6);
    expect(actual.minY).toBeCloseTo(expected.minY, 6);
    expect(actual.maxX).toBeCloseTo(expected.maxX, 6);
    expect(actual.maxY).toBeCloseTo(expected.maxY, 6);
  }

  // A group resize hands each member its own scaled box, starting from exactly
  // its own bounds. A bent or labelled connector measured its curve and label
  // there but scaled only its control points, so it blew up the moment a
  // handle was grabbed — worst on a short, flat line.
  it.each([
    ['a bent line', line({ bend: 20 })],
    ['a labelled line', line({ label: 'hello' })],
    ['a bent arrow', arrow({ topology: 'arc', bend: 20 })],
  ])('keeps %s in its own box', (_, shape) => {
    const util = (shape.type === 'line' ? lineUtil : arrowUtil) as ShapeUtil;
    const b = util.getBounds(shape as never);
    const next = util.resize(shape as never, b);
    expectBounds(
      util.getBounds({ ...shape, x: next.x, y: next.y, props: next.props } as never),
      b,
    );
  });

  it('scales a labelled line to the requested box', () => {
    const shape = line({ label: 'hello' });
    const b = lineUtil.getBounds(shape);
    const target = { ...b, maxX: b.maxX + 40 };
    const next = lineUtil.resize(shape, target);
    expectBounds(
      lineUtil.getBounds({ ...shape, x: next.x, y: next.y, props: next.props }),
      target,
    );
  });
});
