import { beforeAll, describe, expect, it } from 'vitest';
import { ensureGraphMath } from './graph-math';
import { DEFAULT_GRAPH_PARAMETER } from './graph-defaults';
import { reconcileGraphParameters } from './graph-parameters';
import {
  createGraphFunctionDefinitions,
  isCoordinateExpression,
  parseGraphExpression,
} from './graph-parser';
import { GRAPH_MATH_PRESETS, GRAPH_VIEWPORT_PRESETS } from './graph-presets';
import { sampleGraphExpression } from './graph-sampler';
import type { GraphExpression, GraphViewport } from '@whiteboard/shared';

// The mathjs parser is fetched on demand in the app; nothing parses until it
// is in, here included.
beforeAll(() => ensureGraphMath());

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
    if (!parsed.ok || isCoordinateExpression(parsed)) return;
    expect(parsed.normalized).toBe('sin(x)');
    expect(parsed.evaluate(Math.PI / 2, {})).toBeCloseTo(1);
  });

  it('parses polynomial expressions', () => {
    const parsed = parseGraphExpression('x^2 - 4x + 3');

    expect(parsed.ok).toBe(true);
    if (!parsed.ok || isCoordinateExpression(parsed)) return;
    expect(parsed.normalized).toBe('x^2-4*x+3');
    expect(parsed.evaluate(1, {})).toBeCloseTo(0);
  });

  it('reads absolute-value bars, nested and side by side', () => {
    const cases: [string, string, number, number][] = [
      ['|(x+2)/(x-1)|', 'abs((x+2)/(x-1))', 0, 2],
      ['||x|-1|', 'abs(abs(x)-1)', 0, 1],
      ['|x||x-3|', 'abs(x)*abs(x-3)', 1, 2],
      ['2|x|', '2*abs(x)', -3, 6],
    ];
    for (const [source, normalized, x, y] of cases) {
      const parsed = parseGraphExpression(source);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok || isCoordinateExpression(parsed)) return;
      expect(parsed.normalized).toBe(normalized);
      expect(parsed.variables).toEqual([]);
      expect(parsed.evaluate(x, {})).toBeCloseTo(y);
    }
  });

  it('detects slider variables from implicit multiplication', () => {
    const parsed = parseGraphExpression('a*x^2 + bx + c');

    expect(parsed.ok).toBe(true);
    if (!parsed.ok || isCoordinateExpression(parsed)) return;
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

  it('plots a summation written in the equation field', () => {
    // What MathLive hands back for \sum_{i=0}^{10}x^{i}=y.
    const parsed = parseGraphExpression(' sum  _(i=0)^(10)x^i=y');

    expect(parsed.ok).toBe(true);
    if (!parsed.ok || isCoordinateExpression(parsed)) return;
    expect(parsed.kind).toBe('explicit');
    expect(parsed.variables).toEqual([]);
    expect(parsed.evaluate(1, {})).toBeCloseTo(11);
    expect(parsed.evaluate(2, {})).toBeCloseTo(2 ** 11 - 1);
  });

  it('ends a summation at the next top-level term', () => {
    const parsed = parseGraphExpression(' sum  _(n=1)^5n+1');

    expect(parsed.ok).toBe(true);
    if (!parsed.ok || isCoordinateExpression(parsed)) return;
    expect(parsed.evaluate(0, {})).toBeCloseTo(16);
  });

  it('sums to a slider, following it to the nearest whole number', () => {
    // What MathLive hands back for \sum_{n=1}^{k}\left(\cos x\right).
    const parsed = parseGraphExpression('y= sum  _(n=1)^k(cos x)');

    expect(parsed.ok).toBe(true);
    if (!parsed.ok || isCoordinateExpression(parsed)) return;
    expect(parsed.variables).toEqual(['k']);
    const withK = (value: number) => ({
      k: { ...DEFAULT_GRAPH_PARAMETER, value },
    });
    expect(parsed.evaluate(0, withK(3))).toBeCloseTo(3);
    expect(parsed.evaluate(1, withK(4.4))).toBeCloseTo(4 * Math.cos(1));
    // Past the term limit the sum has no value rather than a slow one.
    expect(parsed.evaluate(0, withK(500))).toBeNaN();
  });

  it('shadows the outer index in a nested summation', () => {
    const parsed = parseGraphExpression(' sum  _(n=1)^(3) sum  _(k=1)^(2)n*k*x');

    expect(parsed.ok).toBe(true);
    if (!parsed.ok || isCoordinateExpression(parsed)) return;
    expect(parsed.evaluate(1, {})).toBeCloseTo(18);
  });

  it('rejects summation limits it cannot use', () => {
    expect(parseGraphExpression(' sum  _(n=1)^(500)n').ok).toBe(false);
    expect(parseGraphExpression(' sum  _(x=1)^(3)x').ok).toBe(false);
  });

  it('integrates between its limits', () => {
    // What MathLive hands back for y=\int_1^{x}\sin\left(t\right)\mathrm{d}t.
    const parsed = parseGraphExpression('y= int  _1^x sin (t)d t');

    expect(parsed.ok).toBe(true);
    if (!parsed.ok || isCoordinateExpression(parsed)) return;
    expect(parsed.kind).toBe('explicit');
    expect(parsed.variables).toEqual([]);
    expect(parsed.evaluate(1, {})).toBeCloseTo(0);
    expect(parsed.evaluate(3, {})).toBeCloseTo(Math.cos(1) - Math.cos(3));
    // Below the lower limit the integral runs backwards, and changes sign.
    expect(parsed.evaluate(0, {})).toBeCloseTo(Math.cos(1) - Math.cos(0));
  });

  it('ends an integral at its differential', () => {
    const parsed = parseGraphExpression(' int  _0^1t d t+3');

    expect(parsed.ok).toBe(true);
    if (!parsed.ok || isCoordinateExpression(parsed)) return;
    expect(parsed.evaluate(0, {})).toBeCloseTo(3.5);
  });

  it('finds sliders inside an integrand', () => {
    const parsed = parseGraphExpression(' int  _0^x a t d t');

    expect(parsed.ok).toBe(true);
    if (!parsed.ok || isCoordinateExpression(parsed)) return;
    expect(parsed.variables).toEqual(['a']);
    expect(
      parsed.evaluate(2, { a: { ...DEFAULT_GRAPH_PARAMETER, value: 3 } }),
    ).toBeCloseTo(6);
  });

  it('nests integrals, each over its own variable', () => {
    const parsed = parseGraphExpression(' int  _0^x int  _0^u v d v d u');

    expect(parsed.ok).toBe(true);
    if (!parsed.ok || isCoordinateExpression(parsed)) return;
    expect(parsed.evaluate(3, {})).toBeCloseTo(27 / 6);
  });

  it('rejects integrals it cannot read', () => {
    expect(parseGraphExpression(' int  _0^1t').ok).toBe(false);
    expect(parseGraphExpression(' int  _0^1x d x').ok).toBe(false);
    expect(parseGraphExpression(' int  0^1t d t').ok).toBe(false);
  });

  it('integrates and sums inside a named function and a coordinate', () => {
    const definition = expression('g(z)= int  _0^z u d u');
    const definitions = createGraphFunctionDefinitions([definition]);
    const named = parseGraphExpression(definition.expression, definitions);

    expect(named.ok).toBe(true);
    if (!named.ok || isCoordinateExpression(named)) return;
    expect(named.evaluate(4, {})).toBeCloseTo(8);

    // The bound variable shadows the parametric one, so the coordinate is
    // still swept by the outer `t`.
    const curve = parseGraphExpression('( int  _0^t sin (u)d u,t)');
    expect(curve.ok).toBe(true);
    if (!curve.ok || !isCoordinateExpression(curve)) return;
    expect(curve.kind).toBe('parametric');
    expect(curve.evaluateAt(Math.PI, {}).x).toBeCloseTo(2);
  });

  it('applies a function written without parentheses', () => {
    // MathLive writes \cos x with no parentheses of its own.
    const bare = parseGraphExpression('y=cos x');
    expect(bare.ok).toBe(true);
    if (!bare.ok || isCoordinateExpression(bare)) return;
    expect(bare.normalized).toBe('cos(x)');
    expect(bare.evaluate(0, {})).toBeCloseTo(1);

    // The argument runs over the factors that follow it, and a second function
    // starts a new term rather than nesting.
    const product = parseGraphExpression('y=sin 2x cos x');
    expect(product.ok).toBe(true);
    if (!product.ok || isCoordinateExpression(product)) return;
    expect(product.normalized).toBe('sin(2*x)*cos(x)');
    expect(product.evaluate(1, {})).toBeCloseTo(Math.sin(2) * Math.cos(1));
  });

  it('rejects assignments and other unsupported expression forms', () => {
    const parsed = parseGraphExpression('a = x + 1');

    expect(parsed.ok).toBe(false);
  });

  it('parses and evaluates implicit equations in x and y', () => {
    const parsed = parseGraphExpression('x^2 + y^2 = 1');

    expect(parsed.ok).toBe(true);
    if (!parsed.ok || isCoordinateExpression(parsed)) return;
    expect(parsed.kind).toBe('implicit');
    expect(parsed.normalized).toBe('x^2+y^2=1');
    expect(parsed.evaluate(1, {}, 0)).toBeCloseTo(0);
    expect(parsed.evaluate(0, {}, 0)).toBeCloseTo(-1);
  });

  it('keeps y = f(x) equations on the explicit sampler', () => {
    const parsed = parseGraphExpression('y = x^2');

    expect(parsed.ok).toBe(true);
    if (!parsed.ok || isCoordinateExpression(parsed)) return;
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

describe('discontinuities and steep curves', () => {
  it('breaks a curve at a pole', () => {
    const result = sampleGraphExpression(
      expression('tan(x)'),
      { xMin: -2, xMax: 2, yMin: -5, yMax: 5 },
      {},
      120,
    );

    // One branch either side of -pi/2 and +pi/2.
    expect(result.segments.length).toBeGreaterThanOrEqual(3);
    for (const segment of result.segments) {
      const xs = segment.map((point) => point.x);
      // A branch now runs right up to its asymptotes, so the middle one is
      // exactly pi wide; anything wider crossed a pole.
      expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(
        Math.PI + 1e-9,
      );
    }
  });

  it('keeps a steep but continuous curve in one piece', () => {
    // exp(10x) climbs far more than the viewport height between samples, which
    // a jump-size-only heuristic reads as a discontinuity and chops up.
    const result = sampleGraphExpression(
      expression('exp(10*x)'),
      { xMin: -1, xMax: 1, yMin: -5, yMax: 5 },
      {},
      100,
    );

    expect(result.ok).toBe(true);
    expect(result.segments).toHaveLength(1);
  });

  it.each([
    ['close up', { xMin: -2.3, xMax: 2.3, yMin: -3, yMax: 3 }, 6],
    ['zoomed out', { xMin: -50.5, xMax: 50.5, yMin: -60, yMax: 60 }, 102],
  ])('breaks a step function at each jump, %s', (_, view, steps) => {
    const result = sampleGraphExpression(expression('floor(x)'), view, {}, 600);

    expect(result.segments).toHaveLength(steps);
    for (const segment of result.segments) {
      // Flat treads, no risers: every point sits on the step's own value…
      const level = Math.floor(segment[0]!.x);
      for (const point of segment) expect(point.y).toBe(level);
      // …and the tread runs right up to the jump rather than the last sample.
      const end = segment.at(-1)!.x;
      if (end < view.xMax) expect(end).toBeCloseTo(level + 1, 6);
    }
  });

  it.each(['cbrt(x)', '10*x', 'sqrt(abs(x))'])(
    'keeps the continuous %s in one piece',
    (source) => {
      const result = sampleGraphExpression(
        expression(source),
        { xMin: -2, xMax: 2, yMin: -2, yMax: 2 },
        {},
        600,
      );
      expect(result.segments).toHaveLength(1);
    },
  );

  it.each([
    ['x*y=1', 2],
    ['y^2=x', 1],
    ['x^2+y^2=4', 1],
    ['sin(x)-y=0', 1],
  ])('stitches the implicit %s into %i path(s)', (source, paths) => {
    const result = sampleGraphExpression(
      expression(source),
      { xMin: -10, xMax: 10, yMin: -6, yMax: 6 },
      {},
      543,
      347,
    );
    expect(result.segments).toHaveLength(paths);
  });

  it('clamps runaway values instead of emitting unbounded coordinates', () => {
    const view = { xMin: -1, xMax: 1, yMin: -5, yMax: 5 };
    const result = sampleGraphExpression(expression('1/x'), view, {}, 101);

    const ys = result.segments.flat().map((point) => point.y);
    expect(ys.length).toBeGreaterThan(0);
    // Four viewport heights past the edge is still far outside the clip path.
    for (const y of ys) {
      expect(Math.abs(y)).toBeLessThanOrEqual(45);
    }
    // The curve still leaves the visible area, so the asymptote reads correctly.
    expect(Math.max(...ys)).toBeGreaterThan(view.yMax);
  });

  it('refines a narrow peak beyond the uniform sample budget', () => {
    const samples = 40;
    const result = sampleGraphExpression(
      expression('1/(1+400*x^2)'),
      { xMin: -1, xMax: 1, yMin: -0.5, yMax: 1.5 },
      {},
      samples,
    );

    const count = result.segments.flat().length;
    expect(count).toBeGreaterThan(samples + 1);
  });

  it('refines a parametric curve where a uniform t sweep bends hardest', () => {
    const samples = 40;
    const result = sampleGraphExpression(
      expression('(cos(5*t), sin(3*t))'),
      { xMin: -2, xMax: 2, yMin: -2, yMax: 2 },
      {},
      samples,
    );

    expect(result.segments.flat().length).toBeGreaterThan(samples + 1);
  });

  it('leaves an already-flat curve at its uniform sample count', () => {
    const samples = 40;
    const result = sampleGraphExpression(
      expression('2*x + 1'),
      { xMin: -1, xMax: 1, yMin: -5, yMax: 5 },
      {},
      samples,
    );

    expect(result.segments.flat()).toHaveLength(samples + 1);
  });
});

describe('coordinate expressions', () => {
  it('reads a constant coordinate as a plotted point', () => {
    const parsed = parseGraphExpression('(1, -2)');

    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.kind !== 'point') return;
    expect(parsed.evaluateAt(0, {})).toEqual({ x: 1, y: -2 });
  });

  it('plots a point from an evaluated coordinate', () => {
    const result = sampleGraphExpression(
      expression('(pi/2, 3*2)'),
      viewport,
      {},
      100,
    );

    expect(result.ok).toBe(true);
    expect(result.segments).toEqual([]);
    expect(result.points).toHaveLength(1);
    expect(result.points![0]!.x).toBeCloseTo(Math.PI / 2);
    expect(result.points![0]!.y).toBe(6);
  });

  it('drives point coordinates from slider variables', () => {
    const parsed = parseGraphExpression('(a, a^2)');

    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.kind !== 'point') return;
    expect(parsed.variables).toEqual(['a']);
    expect(
      parsed.evaluateAt(0, { a: { ...DEFAULT_GRAPH_PARAMETER, value: 3 } }),
    ).toEqual({ x: 3, y: 9 });
  });

  it('reads a coordinate in t as a parametric curve', () => {
    const parsed = parseGraphExpression('(cos(t), sin(t))');

    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.kind !== 'parametric') return;
    expect(parsed.normalized).toBe('(cos(t),sin(t))');
    expect(parsed.variables).toEqual([]);
    const point = parsed.evaluateAt(Math.PI, {});
    expect(point.x).toBeCloseTo(-1);
    expect(point.y).toBeCloseTo(0);
  });

  it('sweeps a parametric curve over a full turn by default', () => {
    const result = sampleGraphExpression(
      expression('(2*cos(t), 2*sin(t))'),
      { xMin: -3, xMax: 3, yMin: -3, yMax: 3 },
      {},
      200,
    );

    expect(result.ok).toBe(true);
    expect(result.segments).toHaveLength(1);
    const points = result.segments[0]!;
    expect(Math.min(...points.map((point) => point.x))).toBeCloseTo(-2, 1);
    expect(Math.max(...points.map((point) => point.y))).toBeCloseTo(2, 1);
    // A full sweep closes the circle back on its start.
    expect(points[points.length - 1]!.x).toBeCloseTo(points[0]!.x, 2);
  });

  it('honours an explicit t domain', () => {
    const result = sampleGraphExpression(
      { ...expression('(t, t)'), domain: { min: 1, max: 2 } },
      { xMin: -5, xMax: 5, yMin: -5, yMax: 5 },
      {},
      50,
    );

    expect(result.ok).toBe(true);
    const points = result.segments[0]!;
    expect(points[0]!.x).toBeCloseTo(1);
    expect(points[points.length - 1]!.x).toBeCloseTo(2);
  });

  it('rejects x and y inside a coordinate', () => {
    expect(parseGraphExpression('(x, x^2)').ok).toBe(false);
  });

  it('leaves function calls and grouped arithmetic alone', () => {
    const call = parseGraphExpression('max(1, x)');
    expect(call.ok).toBe(true);
    if (call.ok) expect(call.kind).toBe('explicit');

    const grouped = parseGraphExpression('(x + 1)*(x - 1)');
    expect(grouped.ok).toBe(true);
    if (grouped.ok) expect(grouped.kind).toBe('explicit');
  });
});

describe('named function points', () => {
  it('defines f(x) and evaluates a point at (k, f(k))', () => {
    const definition = expression('f(x)=x^2');
    const point = expression('(k,f(k))');
    const definitions = createGraphFunctionDefinitions([definition, point]);

    const parsedDefinition = parseGraphExpression(
      definition.expression,
      definitions,
    );
    expect(parsedDefinition.ok).toBe(true);
    if (!parsedDefinition.ok || isCoordinateExpression(parsedDefinition)) return;
    expect(parsedDefinition.kind).toBe('explicit');
    expect(parsedDefinition.evaluate(3, {})).toBe(9);

    const parsedPoint = parseGraphExpression(point.expression, definitions);
    expect(parsedPoint.ok).toBe(true);
    if (!parsedPoint.ok || parsedPoint.kind !== 'point') return;
    expect(parsedPoint.variables).toEqual(['k']);
    expect(
      parsedPoint.evaluateAt(0, {
        k: { ...DEFAULT_GRAPH_PARAMETER, value: 3 },
      }),
    ).toEqual({ x: 3, y: 9 });
  });

  it('plots a named-function point with the current slider value', () => {
    const definition = expression('f(x)=x^2');
    const point = expression('(k,f(k))');
    const definitions = createGraphFunctionDefinitions([definition, point]);
    const result = sampleGraphExpression(
      point,
      viewport,
      { k: { ...DEFAULT_GRAPH_PARAMETER, value: -2 } },
      100,
      100,
      definitions,
    );

    expect(result.ok).toBe(true);
    expect(result.points).toEqual([{ x: -2, y: 4 }]);
  });

  it('keeps function parameters available when only the dependent point is visible', () => {
    const definition = {
      ...expression('f(x)=a*x^2'),
      visible: false,
    };
    const point = expression('(k,f(k))');
    const parameters = reconcileGraphParameters([definition, point], {});

    expect(Object.keys(parameters)).toEqual(['a', 'k']);
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
      if (!parsed.ok || isCoordinateExpression(parsed)) return;
      expect(parsed.evaluate(x, {})).toBeCloseTo(expected);
    });
  }

  it('reserves new function names so they must be called', () => {
    const parsed = parseGraphExpression('sec');
    expect(parsed.ok).toBe(false);
  });
});

describe('graph math presets', () => {
  it.each(GRAPH_MATH_PRESETS)(
    'parses the $name preset as ASCII math',
    (preset) => {
      const parsed = parseGraphExpression(preset.expression);
      expect(parsed.ok ? null : parsed.message).toBe(null);
    },
  );

  it('has a unique name and description for each preset', () => {
    const names = new Set(GRAPH_MATH_PRESETS.map((p) => p.name));
    expect(names.size).toBe(GRAPH_MATH_PRESETS.length);
    for (const preset of GRAPH_MATH_PRESETS) {
      expect(preset.description).toBeTruthy();
    }
  });

  it('drives sliders from the parabola preset', () => {
    const parsed = parseGraphExpression(
      GRAPH_MATH_PRESETS.find((p) => p.name === 'Parabola')!.expression,
    );
    expect(parsed.ok && parsed.variables).toEqual(['a', 'b', 'c']);
  });
});

describe('graph viewport presets', () => {
  it('defines structured, valid mathematical viewport presets', () => {
    expect(GRAPH_VIEWPORT_PRESETS.length).toBeGreaterThanOrEqual(7);

    const names = new Set<string>();
    const shortLabels = new Set<string>();

    for (const preset of GRAPH_VIEWPORT_PRESETS) {
      expect(preset.name).toBeTruthy();
      expect(preset.shortLabel).toBeTruthy();
      expect(preset.label).toBeTruthy();
      expect(preset.category).toBeTruthy();
      expect(preset.description).toBeTruthy();

      expect(names.has(preset.name)).toBe(false);
      expect(shortLabels.has(preset.shortLabel)).toBe(false);
      names.add(preset.name);
      shortLabels.add(preset.shortLabel);

      expect(preset.viewport.xMin).toBeLessThan(preset.viewport.xMax);
      expect(preset.viewport.yMin).toBeLessThan(preset.viewport.yMax);
      expect(Number.isFinite(preset.viewport.xMin)).toBe(true);
      expect(Number.isFinite(preset.viewport.xMax)).toBe(true);
      expect(Number.isFinite(preset.viewport.yMin)).toBe(true);
      expect(Number.isFinite(preset.viewport.yMax)).toBe(true);
    }
  });

  it('includes standard, trigonometric, and geometric presets', () => {
    const categories = new Set(GRAPH_VIEWPORT_PRESETS.map((p) => p.category));
    expect(categories).toContain('Standard & Zoom');
    expect(categories).toContain('Trigonometric');
    expect(categories).toContain('Special Domains');
  });
});
