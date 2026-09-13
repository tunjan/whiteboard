import { beforeAll, describe, expect, it } from 'vitest';
import type { GraphExpression } from '@whiteboard/shared';
import { ensureGraphMath } from './graph-math';
import {
  createGraphFunctionDefinitions,
  parseGraphExpression,
} from './graph-parser';
import { reconcileGraphParameters } from './graph-parameters';
import { sampleGraphExpression } from './graph-sampler';
import { findGraphIntersections } from './graph-intersections';
import {
  DEFAULT_GRAPH_PARAMETER,
  DEFAULT_GRAPH_VIEWPORT,
} from './graph-defaults';

beforeAll(ensureGraphMath);
const expression = (source: string, visible = true): GraphExpression => ({
  id: source,
  expression: source,
  visible,
  color: '#000',
  dash: 'solid',
});

describe('slider settings survive exploration', () => {
  const parameters = {
    a: { ...DEFAULT_GRAPH_PARAMETER, value: 7, min: -20, max: 30 },
  };
  it('preserves settings through hide/show', () => {
    const hidden = reconcileGraphParameters(
      [expression('y=a*x', false)],
      parameters,
    );
    const shown = reconcileGraphParameters([expression('y=a*x')], hidden);
    expect(shown.a).toEqual(parameters.a);
  });
  it.each(['y=a*x+', ''])(
    'preserves settings through the draft %j',
    (draft) => {
      const incomplete = reconcileGraphParameters(
        [expression(draft)],
        parameters,
      );
      const complete = reconcileGraphParameters(
        [expression('y=a*x+1')],
        incomplete,
      );
      expect(complete.a).toEqual(parameters.a);
    },
  );
  it('removes settings after their expression is deleted', () => {
    expect(reconcileGraphParameters([expression('y=x')], parameters)).toEqual(
      {},
    );
  });
});

describe('implicit contours reject discontinuities', () => {
  it.each([
    '1/(x-0.123)=0',
    '1/(y-0.123)=0',
    '1000000/(x-0.123)=0',
    '0.000001/(x-0.123)=0',
  ])('does not invent solutions to %s', (source) => {
    const result = sampleGraphExpression(
      expression(source),
      DEFAULT_GRAPH_VIEWPORT,
      {},
      543,
      347,
    );
    expect(result.ok).toBe(true);
    expect(result.segments).toHaveLength(0);
  });
  it('retains genuine roots alongside a pole', () => {
    const result = sampleGraphExpression(
      expression('(x-2)/(x-0.123)=0'),
      DEFAULT_GRAPH_VIEWPORT,
      {},
      543,
      347,
    );
    expect(result.segments.length).toBeGreaterThan(0);
    for (const point of result.segments.flat())
      expect(point.x).toBeCloseTo(2, 5);
  });
  it('keeps a continuous circle closed', () => {
    const result = sampleGraphExpression(
      expression('x^2+y^2=4'),
      DEFAULT_GRAPH_VIEWPORT,
      {},
      543,
      347,
    );
    expect(result.segments).toHaveLength(1);
    const curve = result.segments[0]!;
    expect(curve[0]!.x).toBeCloseTo(curve.at(-1)!.x, 5);
    expect(curve[0]!.y).toBeCloseTo(curve.at(-1)!.y, 5);
    for (const p of curve) expect(p.x * p.x + p.y * p.y).toBeCloseTo(4, 5);
  });
});

describe('tangent intersections', () => {
  it.each([
    '(x-0.123)^2',
    '-(x-0.123)^2',
    '(x-0.123)^4',
    '0.000001*(x-0.123)^2',
  ])('finds the x-axis contact for %s', (source) => {
    const roots = findGraphIntersections(
      [expression(source)],
      DEFAULT_GRAPH_VIEWPORT,
      {},
    ).filter((p) => p.kind === 'x-axis');
    expect(roots).toHaveLength(1);
    expect(roots[0]!.x).toBeCloseTo(0.123, 5);
  });
  it('finds two curves touching without crossing', () => {
    const points = findGraphIntersections(
      [expression('(x-0.123)^2+1'), expression('1')],
      DEFAULT_GRAPH_VIEWPORT,
      {},
    ).filter((p) => p.kind === 'curve-curve');
    expect(points).toHaveLength(1);
    expect(points[0]!.x).toBeCloseTo(0.123, 5);
    expect(points[0]!.y).toBeCloseTo(1, 5);
  });
  it.each([
    '(x-0.123)^2+0.000001',
    '0.000001*((x-0.123)^2+0.000001)',
    '1/(x-0.123)',
  ])('does not report a root for %s', (source) => {
    expect(
      findGraphIntersections(
        [expression(source)],
        DEFAULT_GRAPH_VIEWPORT,
        {},
      ).filter((p) => p.kind === 'x-axis'),
    ).toHaveLength(0);
  });
});

describe('aggregate variables have lexical scope', () => {
  const withN = { n: { ...DEFAULT_GRAPH_PARAMETER, value: 2 } };
  it.each([
    ['n+ sum _(n=1)^3 n', 8],
    ['sum _(n=1)^3 n+n', 8],
    ['sum _(n=1)^n n', 3],
    ['sum _(k=1)^2 (n+ sum _(n=1)^3 n)', 16],
    ['n+ int _0^1 n d n', 2.5],
  ])('resolves free and bound n separately in %s', (source, expected) => {
    const parsed = parseGraphExpression(source);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.kind !== 'explicit')
      throw new Error('Expected explicit function');
    expect(parsed.variables).toEqual(['n']);
    expect(parsed.evaluate(0, withN)).toBeCloseTo(expected);
  });
  it('keeps a free t in coordinates parametric when an integral binds t', () => {
    const parsed = parseGraphExpression('(t+ int _0^1 t d t,t)');
    expect(parsed.ok && parsed.kind).toBe('parametric');
    if (!parsed.ok || parsed.kind !== 'parametric')
      throw new Error('Expected parametric curve');
    expect(parsed.variables).toEqual([]);
    expect(parsed.evaluateAt(2, {})).toEqual({ x: 2.5, y: 2 });
  });
  it('discovers parameters in a named function aggregate body', () => {
    const rows = [
      expression('f(x)=n+ sum _(n=1)^3 (n+a*x)'),
      expression('f(x)'),
    ];
    const definitions = createGraphFunctionDefinitions(rows);
    const parsed = parseGraphExpression('f(x)', definitions);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.kind !== 'explicit')
      throw new Error('Expected explicit function');
    expect(parsed.variables).toEqual(['a', 'n']);
    expect(
      parsed.evaluate(2, {
        ...withN,
        a: { ...DEFAULT_GRAPH_PARAMETER, value: 3 },
      }),
    ).toBe(26);
  });
});
