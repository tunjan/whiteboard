import { beforeAll, describe, expect, it } from 'vitest';
import type { GraphExpression } from '@whiteboard/shared';
import { ensureGraphMath } from './graph-math';
import {
  createGraphFunctionDefinitions,
  parseGraphExpression,
} from './graph-parser';
import { findGraphIntersections } from './graph-intersections';
import { sampleGraphExpression } from './graph-sampler';
import { fitViewport, warpParsed, type GraphAxes } from './graph-scale';
import { axisTicks, formatTick, plotsTrig } from './graph-ticks';

beforeAll(() => ensureGraphMath());

const row = (expression: string, id = expression): GraphExpression => ({
  id,
  expression,
  color: '#000',
  visible: true,
  dash: 'solid',
});

function parsed(source: string, rows: string[] = [source]) {
  const result = parseGraphExpression(
    source,
    createGraphFunctionDefinitions(
      rows.map((r) => row(r)),
      'deg',
    ),
  );
  if (!result.ok) throw new Error(result.message);
  return result;
}

describe('degrees', () => {
  it('reads trig arguments and answers inverse trig in degrees', () => {
    const sin = parsed('y=sin(x)');
    const asin = parsed('y=asin(x)');
    if (sin.kind !== 'explicit' || asin.kind !== 'explicit') throw new Error();
    expect(sin.evaluate(90, {})).toBeCloseTo(1);
    expect(sin.evaluate(30, {})).toBeCloseTo(0.5);
    expect(asin.evaluate(1, {})).toBeCloseTo(90);
    // A bare call and a power of one still convert once.
    const bare = parsed('y=2cos x^2');
    if (bare.kind !== 'explicit') throw new Error();
    expect(bare.evaluate(Math.sqrt(180), {})).toBeCloseTo(-2);
  });

  it('carries into user functions, restrictions and polar curves', () => {
    const rows = ['f(x)=cos(x)', 'y=f(x)'];
    const viaF = parsed('y=f(x)', rows);
    if (viaF.kind !== 'explicit') throw new Error();
    expect(viaF.evaluate(180, {})).toBeCloseTo(-1);

    const restricted = parsed('y=x{sin(x)>0}');
    if (restricted.kind !== 'explicit') throw new Error();
    expect(restricted.evaluate(90, {})).toBe(90);
    expect(Number.isNaN(restricted.evaluate(270, {}))).toBe(true);

    const polar = parsed('r=1');
    if (polar.kind !== 'parametric') throw new Error();
    const at = polar.evaluateAt(90, {});
    expect(at.x).toBeCloseTo(0);
    expect(at.y).toBeCloseTo(1);
  });

  it('leaves radians alone', () => {
    const sin = parseGraphExpression('y=sin(x)');
    if (!sin.ok || sin.kind !== 'explicit') throw new Error();
    expect(sin.evaluate(Math.PI / 2, {})).toBeCloseTo(1);
  });
});

describe('log axes', () => {
  const logLog: GraphAxes = { x: 'log', y: 'log' };

  it('turns a power law into a line in plot space', () => {
    const result = parseGraphExpression('y=x^2');
    if (!result.ok || result.kind !== 'explicit') throw new Error();
    const g = warpParsed(result, logLog);
    if (g.kind !== 'explicit') throw new Error();
    expect(g.evaluate(1, {})).toBeCloseTo(2);
    expect(g.evaluate(-1, {})).toBeCloseTo(-2);
  });

  it('samples in plot space and gaps where y is not positive', () => {
    const { segments } = sampleGraphExpression(
      row('y=x-10'),
      { xMin: 1, xMax: 100, yMin: 0.1, yMax: 100 },
      {},
      200,
      200,
      undefined,
      logLog,
    );
    expect(segments.length).toBe(1);
    // Starts just past x = 10, where x - 10 turns positive.
    expect(10 ** segments[0]![0]!.x).toBeGreaterThan(10);
    expect(10 ** segments[0]![0]!.x).toBeLessThan(10.5);
  });

  it('finds intersections in plot space and no axis crossings', () => {
    const expressions = [row('y=x', 'a'), row('y=10', 'b')];
    const points = findGraphIntersections(
      expressions,
      { xMin: 1, xMax: 100, yMin: 1, yMax: 100 },
      {},
      240,
      undefined,
      undefined,
      logLog,
    );
    expect(points).toHaveLength(1);
    expect(points[0]!.x).toBeCloseTo(1);
    expect(points[0]!.y).toBeCloseTo(1);
  });

  it('fits a window that reaches zero', () => {
    expect(
      fitViewport(
        { xMin: -10, xMax: 10, yMin: -5, yMax: 5 },
        { x: 'log', y: 'linear' },
      ),
    ).toEqual({
      xMin: 0.01,
      xMax: 10,
      yMin: -5,
      yMax: 5,
    });
  });
});

describe('ticks', () => {
  const labels = (
    min: number,
    max: number,
    size: number,
    style: Parameters<typeof axisTicks>[3],
  ) => axisTicks(min, max, size, style).major.map((t) => t.label);

  it('writes numbers the way a textbook sets them', () => {
    expect(formatTick(-3)).toBe('−3');
    expect(formatTick(1e6)).toBe('10⁶');
    expect(formatTick(-0.00025)).toBe('−2.5×10⁻⁴');
    expect(formatTick(0.1 + 0.2)).toBe('0.3');
  });

  it('counts a trig plot in π and in degrees', () => {
    expect(labels(-2 * Math.PI, 2 * Math.PI, 388, 'pi')).toEqual([
      '−2π',
      '−3π/2',
      '−π',
      '−π/2',
      '0',
      'π/2',
      'π',
      '3π/2',
      '2π',
    ]);
    expect(labels(-0.3, 0.3, 388, 'pi')).toContain('0.1');
    expect(labels(-360, 360, 388, 'degrees')).toEqual([
      '−360°',
      '−270°',
      '−180°',
      '−90°',
      '0°',
      '90°',
      '180°',
      '270°',
      '360°',
    ]);
  });

  it('labels decades, then fills one in as it is zoomed', () => {
    expect(labels(0.01, 1000, 388, 'log')).toEqual([
      '0.01',
      '0.1',
      '1',
      '10',
      '100',
      '1000',
    ]);
    expect(labels(1, 10, 388, 'log')).toEqual(['1', '2', '5', '10']);
    expect(labels(1e-12, 1e12, 248, 'log')).toEqual([
      '10⁻¹⁰',
      '10⁻⁵',
      '1',
      '10⁵',
      '10¹⁰',
    ]);
  });

  it('treats only curves in x as trig plots', () => {
    expect(plotsTrig([row('y=sin(x)')])).toBe(true);
    expect(plotsTrig([row('(cos(t),sin(t))'), row('r=sin(2θ)')])).toBe(false);
  });
});
