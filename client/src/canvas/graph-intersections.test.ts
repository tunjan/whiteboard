import { beforeAll, describe, expect, it } from 'vitest';
import { ensureGraphMath } from './graph-math';
import { DEFAULT_GRAPH_PARAMETER } from './graph-defaults';
import {
  MAX_INTERSECTIONS,
  findGraphIntersections,
  formatIntersectionCoordinate,
  formatIntersectionLabel,
} from './graph-intersections';
import type { GraphExpression, GraphViewport } from '@whiteboard/shared';

// The mathjs parser is fetched on demand in the app; nothing parses until it
// is in, here included.
beforeAll(() => ensureGraphMath());

const viewport: GraphViewport = {
  xMin: -5,
  xMax: 5,
  yMin: -5,
  yMax: 5,
};

function expression(source: string, visible = true): GraphExpression {
  return {
    id: `expr-${source}`,
    expression: source,
    color: '#000000',
    visible,
    dash: 'solid',
  };
}

describe('graph intersections', () => {
  it('finds x-axis roots and the y-axis crossing of a parabola', () => {
    const points = findGraphIntersections(
      [expression('x^2 - 4x + 3')],
      { xMin: -1, xMax: 5, yMin: -5, yMax: 5 },
      {},
    );

    const roots = points
      .filter((p) => p.kind === 'x-axis')
      .map((p) => p.x)
      .sort((a, b) => a - b);
    expect(roots).toHaveLength(2);
    expect(roots[0]).toBeCloseTo(1, 5);
    expect(roots[1]).toBeCloseTo(3, 5);

    const yAxis = points.filter((p) => p.kind === 'y-axis');
    expect(yAxis).toHaveLength(1);
    expect(yAxis[0]!.y).toBeCloseTo(3, 5);
  });

  it('reports a point once even when its copies straddle a dedupe cell edge', () => {
    // One sample per unit, so x ≈ 2.5 sits on a rounding boundary. The
    // curve-curve scan lands a hair below it, the x-axis
    // bisection a hair above, and both must still read as one point.
    const c = '2.500000000001';
    const points = findGraphIntersections(
      [expression(`sin(x - ${c})`), expression(`x - ${c}`)],
      { xMin: 0, xMax: 240, yMin: -5, yMax: 5 },
      {},
      240,
    );
    const atRoot = points.filter(
      (p) => Math.abs(p.x - 2.5) < 1e-3 && Math.abs(p.y) < 1e-3,
    );
    expect(atRoot).toHaveLength(1);
  });

  it('finds intersections between two curves', () => {
    const points = findGraphIntersections(
      [expression('x^2'), expression('2 - x')],
      viewport,
      {},
    );

    const crossings = points
      .filter((p) => p.kind === 'curve-curve')
      .sort((a, b) => a.x - b.x);
    expect(crossings).toHaveLength(2);
    expect(crossings[0]!.x).toBeCloseTo(-2, 5);
    expect(crossings[0]!.y).toBeCloseTo(4, 5);
    expect(crossings[1]!.x).toBeCloseTo(1, 5);
    expect(crossings[1]!.y).toBeCloseTo(1, 5);
  });

  it('does not report asymptotes as roots', () => {
    const points = findGraphIntersections(
      [expression('tan(x)')],
      { xMin: -1, xMax: 4, yMin: -5, yMax: 5 },
      {},
    );

    const roots = points
      .filter((p) => p.kind === 'x-axis')
      .map((p) => p.x)
      .sort((a, b) => a - b);
    expect(roots).toHaveLength(2);
    expect(roots[0]).toBeCloseTo(0, 5);
    expect(roots[1]).toBeCloseTo(Math.PI, 5);
  });

  it('uses slider parameter values', () => {
    const points = findGraphIntersections(
      [expression('sin(a*x)')],
      { xMin: 0.5, xMax: 2.5, yMin: -5, yMax: 5 },
      { a: { ...DEFAULT_GRAPH_PARAMETER, value: 2 } },
    );

    const roots = points.filter((p) => p.kind === 'x-axis').map((p) => p.x);
    expect(roots).toHaveLength(1);
    expect(roots[0]).toBeCloseTo(Math.PI / 2, 5);
  });

  it('skips the y-axis crossing when x = 0 is out of view', () => {
    const points = findGraphIntersections(
      [expression('x + 1')],
      { xMin: 1, xMax: 5, yMin: -5, yMax: 5 },
      {},
    );

    expect(points.filter((p) => p.kind === 'y-axis')).toHaveLength(0);
  });

  it('ignores implicit relations', () => {
    const points = findGraphIntersections(
      [expression('x^2 + y^2 = 1'), expression('y = x')],
      viewport,
      {},
    );

    expect(points.filter((p) => p.kind === 'curve-curve')).toHaveLength(0);
    // The explicit line still crosses the origin.
    expect(points.some((p) => p.kind === 'x-axis')).toBe(true);
  });

  it('ignores hidden curves', () => {
    const points = findGraphIntersections(
      [expression('x^2', false), expression('2 - x')],
      viewport,
      {},
    );

    expect(points.filter((p) => p.kind === 'curve-curve')).toHaveLength(0);
  });

  it('caps the number of reported intersections', () => {
    const points = findGraphIntersections(
      [expression('sin(40x)')],
      { xMin: -20, xMax: 20, yMin: -5, yMax: 5 },
      {},
    );

    expect(points.length).toBeLessThanOrEqual(MAX_INTERSECTIONS);
  });

  describe('formatIntersectionCoordinate & formatIntersectionLabel', () => {
    it('formats integers without decimals', () => {
      expect(formatIntersectionCoordinate(0)).toBe('0');
      expect(formatIntersectionCoordinate(5)).toBe('5');
      expect(formatIntersectionCoordinate(-3)).toBe('-3');
    });

    it('formats single decimal numbers cleanly', () => {
      expect(formatIntersectionCoordinate(2.5)).toBe('2.5');
      expect(formatIntersectionCoordinate(-0.5)).toBe('-0.5');
    });

    it('formats two decimal places cleanly', () => {
      expect(formatIntersectionCoordinate(1.25)).toBe('1.25');
      expect(formatIntersectionCoordinate(-3.75)).toBe('-3.75');
    });

    it('rounds to at most two decimal places', () => {
      expect(formatIntersectionCoordinate(1.41421356)).toBe('1.41');
      expect(formatIntersectionCoordinate(3.14159)).toBe('3.14');
      expect(formatIntersectionCoordinate(0.333333)).toBe('0.33');
      expect(formatIntersectionCoordinate(0.666666)).toBe('0.67');
      expect(formatIntersectionCoordinate(-2.666666)).toBe('-2.67');
    });

    it('avoids negative zero from rounding small negative numbers', () => {
      expect(formatIntersectionCoordinate(-0.0001)).toBe('0');
      expect(formatIntersectionCoordinate(-0)).toBe('0');
    });

    it('formats point labels with (x, y)', () => {
      expect(formatIntersectionLabel({ x: 1.414, y: 2 })).toBe('(1.41, 2)');
      expect(formatIntersectionLabel({ x: 0, y: 0 })).toBe('(0, 0)');
      expect(formatIntersectionLabel({ x: -0.3333, y: 5.6789 })).toBe('(-0.33, 5.68)');
    });
  });
});
