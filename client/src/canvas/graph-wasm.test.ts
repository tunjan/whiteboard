import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ensureGraphMath } from './graph-math';
import { parseGraphExpression, type ParsedGraphFunction } from './graph-parser';
import {
  graphWasmActive,
  graphWasmProgram,
  setGraphWasmEnabled,
} from './graph-wasm';

beforeAll(() => ensureGraphMath());
afterEach(() => setGraphWasmEnabled(true));

const param = (value: number) => ({ value, min: -10, max: 10, step: 0.1 });

/** Both evaluators for one source: Rust (default) and the mathjs fallback. */
function bothPaths(source: string, parameters = {}) {
  const parsed = parseGraphExpression(source) as ParsedGraphFunction;
  expect(parsed.ok).toBe(true);
  const rust = parsed.createEvaluator(parameters);
  setGraphWasmEnabled(false);
  const mathjs = parsed.createEvaluator(parameters);
  setGraphWasmEnabled(true);
  return { rust, mathjs };
}

describe('Rust graph evaluator', () => {
  it('loads in tests', () => {
    expect(graphWasmActive()).toBe(true);
  });

  it.each([
    'y = sin(x) + cos(x) - tan(x)',
    'y = asin(x/10) + acos(x/10) + atan(x)',
    'y = sinh(x/4) + cosh(x/4) * tanh(x)',
    'y = sec(x) + csc(x) + cot(x)',
    'y = sqrt(x) + cbrt(x) + abs(x) + sign(x)',
    'y = ln(x) + log(x) + log(x, 2) + exp(-x)',
    'y = floor(x) + ceil(x) + round(x)',
    'y = min(x, 2) + max(x, -1)',
    'y = mod(x, 3) + mod(x, -2) + mod(x, 0)',
    // NaN in either argument: mathjs returns NaN, `f64::max` the other one.
    'y = max(ln(x), -3)',
    'y = max(-3, ln(x))',
    'y = min(sqrt(x), 2)',
    'y = round(x / 0.1) + mod(x, 0.1)',
    'y = log_2(x) + log_(10) x',
    'y = -x^2 + 2^-x + x^3/7 + (-2)^x',
    'y = a*x^2 + b*x + c',
    'y = pi*e*x',
    'x^2 + y^2 = 25',
    'sin(x*y) = cos(x) + a*y',
  ])('matches mathjs for %s', (source) => {
    const { rust, mathjs } = bothPaths(source, { a: param(0.7), b: param(-2) });
    const check = (x: number, y: number) => {
      const expected = mathjs(x, y);
      const actual = rust(x, y);
      if (Number.isNaN(expected)) expect(actual).toBeNaN();
      else expect(actual).toBeCloseTo(expected, 9);
    };
    for (let i = -20; i <= 20; i += 1) check(i / 2 + 0.013, i / 3 - 0.007);
    for (const x of [0.3, -0.3, 0.7, -0.7]) check(x, x);
  });

  it('compiles what it supports and declines the rest', () => {
    expect(graphWasmProgram('x^2+a', ['a']).bind({})).not.toBeNull();
    expect(graphWasmProgram('x%3', []).bind({})).toBeNull();
    expect(graphWasmProgram('min(x,1,2)', []).bind({})).toBeNull();
    expect(graphWasmProgram('x+q', []).bind({})).toBeNull();
  });

  it('falls back to mathjs for syntax Rust does not compile', () => {
    const parsed = parseGraphExpression('y = x % 3') as ParsedGraphFunction;
    expect(parsed.createEvaluator({})(7)).toBe(1);
  });

  it('keeps two bindings of one expression apart', () => {
    const parsed = parseGraphExpression('y = a*x') as ParsedGraphFunction;
    const two = parsed.createEvaluator({ a: param(2) });
    const three = parsed.createEvaluator({ a: param(3) });
    expect(two(5)).toBe(10);
    expect(three(5)).toBe(15);
    expect(two(5)).toBe(10);
  });
});
