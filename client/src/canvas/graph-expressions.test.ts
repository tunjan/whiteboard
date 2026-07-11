import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GRAPH_PARAMETER,
  parseGraphExpression,
  reconcileGraphParameters,
  sampleGraphExpression,
} from './graph-expressions';
import type { GraphExpression, GraphViewport } from '@whiteboard/shared';

const viewport: GraphViewport = {
  xMin: -1,
  xMax: 1,
  yMin: -5,
  yMax: 5,
};

function expression(source: string): GraphExpression {
  return {
    id: 'expr-test',
    expression: source,
    color: '#000000',
    visible: true,
    dash: 'solid',
  };
}

describe('graph expressions', () => {
  it('parses y-prefixed standard functions', () => {
    const parsed = parseGraphExpression('y = sin(x)');

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.normalized).toBe('sin(x)');
    expect(parsed.evaluate(Math.PI / 2, {})).toBeCloseTo(1);
  });

  it('parses polynomial expressions', () => {
    const parsed = parseGraphExpression('x^2 - 4x + 3');

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.normalized).toBe('x^2-4*x+3');
    expect(parsed.evaluate(1, {})).toBeCloseTo(0);
  });

  it('detects slider variables from implicit multiplication', () => {
    const parsed = parseGraphExpression('a*x^2 + bx + c');

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.variables).toEqual(['a', 'b', 'c']);
    expect(parsed.normalized).toBe('a*x^2+b*x+c');
    expect(
      parsed.evaluate(2, {
        a: { ...DEFAULT_GRAPH_PARAMETER, value: 2 },
        b: { ...DEFAULT_GRAPH_PARAMETER, value: 3 },
        c: { ...DEFAULT_GRAPH_PARAMETER, value: 4 },
      }),
    ).toBeCloseTo(18);
  });

  it('rejects assignments and other unsupported expression forms', () => {
    const parsed = parseGraphExpression('a = x + 1');

    expect(parsed.ok).toBe(false);
  });

  it('parses and evaluates implicit equations in x and y', () => {
    const parsed = parseGraphExpression('x^2 + y^2 = 1');

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.kind).toBe('implicit');
    expect(parsed.normalized).toBe('x^2+y^2=1');
    expect(parsed.evaluate(1, {}, 0)).toBeCloseTo(0);
    expect(parsed.evaluate(0, {}, 0)).toBeCloseTo(-1);
  });

  it('keeps y = f(x) equations on the explicit sampler', () => {
    const parsed = parseGraphExpression('y = x^2');

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.kind).toBe('explicit');
    expect(parsed.normalized).toBe('x^2');
    expect(parsed.evaluate(3, {})).toBe(9);
  });

  it('samples closed implicit curves', () => {
    const result = sampleGraphExpression(
      expression('x^2 + y^2 = 1'),
      { xMin: -2, xMax: 2, yMin: -2, yMax: 2 },
      {},
      160,
      160,
    );

    expect(result.ok).toBe(true);
    expect(result.segments).toHaveLength(1);
    const points = result.segments[0]!;
    expect(points.length).toBeGreaterThan(30);
    expect(Math.min(...points.map((point) => point.x))).toBeCloseTo(-1, 1);
    expect(Math.max(...points.map((point) => point.x))).toBeCloseTo(1, 1);
    expect(Math.min(...points.map((point) => point.y))).toBeCloseTo(-1, 1);
    expect(Math.max(...points.map((point) => point.y))).toBeCloseTo(1, 1);
  });

  it('samples vertical implicit curves', () => {
    const result = sampleGraphExpression(
      expression('x = 0.25'),
      { xMin: -1, xMax: 1, yMin: -1, yMax: 1 },
      {},
      100,
      100,
    );

    expect(result.ok).toBe(true);
    expect(result.segments).toHaveLength(1);
    expect(
      result.segments[0]!.every((point) => Math.abs(point.x - 0.25) < 1e-8),
    ).toBe(true);
  });

  it('rejects missing function arguments before sampling', () => {
    const parsed = parseGraphExpression('cos()');
    const result = sampleGraphExpression(expression('cos()'), viewport, {}, 100);

    expect(parsed.ok).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.segments).toEqual([]);
  });

  it('preserves prior slider values when reconciling parameters', () => {
    const next = reconcileGraphParameters(
      [expression('a*x + b')],
      {
        a: { value: 3, min: -5, max: 5, step: 0.5 },
        unused: { value: 10, min: 0, max: 10, step: 1 },
      },
    );

    expect(Object.keys(next)).toEqual(['a', 'b']);
    expect(next.a?.value).toBe(3);
    expect(next.b?.value).toBe(DEFAULT_GRAPH_PARAMETER.value);
  });

  it('splits non-finite output instead of drawing through discontinuities', () => {
    const result = sampleGraphExpression(expression('1 / x'), viewport, {}, 100);

    expect(result.ok).toBe(true);
    expect(result.segments.length).toBeGreaterThanOrEqual(2);
    expect(result.segments.every((segment) => segment.length > 1)).toBe(true);
  });

  it('returns an invalid sample result for bad expressions without throwing', () => {
    const result = sampleGraphExpression(expression('sin('), viewport, {}, 100);

    expect(result.ok).toBe(false);
    expect(result.segments).toEqual([]);
  });
});

describe('expanded function library', () => {
  const cases: { source: string; x: number; expected: number }[] = [
    { source: 'arctan(x)', x: 1, expected: Math.atan(1) },
    { source: 'asin(x)', x: 0.5, expected: Math.asin(0.5) },
    { source: 'arccos(x)', x: 0.5, expected: Math.acos(0.5) },
    { source: 'sinh(x)', x: 1, expected: Math.sinh(1) },
    { source: 'cosh(x)', x: 1, expected: Math.cosh(1) },
    { source: 'tanh(x)', x: 1, expected: Math.tanh(1) },
    { source: 'sec(x)', x: 1, expected: 1 / Math.cos(1) },
    { source: 'csc(x)', x: 1, expected: 1 / Math.sin(1) },
    { source: 'cot(x)', x: 1, expected: 1 / Math.tan(1) },
    { source: 'cbrt(x)', x: 27, expected: 3 },
    { source: 'sign(x)', x: -4, expected: -1 },
  ];

  for (const { source, x, expected } of cases) {
    it(`parses and evaluates ${source}`, () => {
      const parsed = parseGraphExpression(source);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.evaluate(x, {})).toBeCloseTo(expected);
    });
  }

  it('reserves new function names so they must be called', () => {
    const parsed = parseGraphExpression('sec');
    expect(parsed.ok).toBe(false);
  });
});
