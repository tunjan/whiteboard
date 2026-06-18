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
