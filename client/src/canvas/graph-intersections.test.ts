import { describe, expect, it } from 'vitest';
import { DEFAULT_GRAPH_PARAMETER } from './graph-expressions';
import {
  MAX_INTERSECTIONS,
  findGraphIntersections,
} from './graph-intersections';
import type { GraphExpression, GraphViewport } from '@whiteboard/shared';

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
});
