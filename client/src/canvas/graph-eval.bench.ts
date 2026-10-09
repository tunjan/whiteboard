/**
 * Graph evaluation: the Rust/WASM evaluator (shipping) vs its mathjs fallback
 * vs plain JS closures compiled from the same mathjs AST.
 *
 *   npx vitest bench --run src/canvas/graph-eval.bench.ts
 *
 * Every row runs the real sampler, so contour stitching, refinement and
 * allocation are all in the number. The closure row is there to separate
 * "Rust is faster" from "not mathjs is faster".
 */
import { bench, describe } from 'vitest';
import { parse, type MathNode } from 'mathjs/number';
import type { GraphParameter, GraphViewport } from '@whiteboard/shared';
import { ensureGraphMath } from './graph-math';
import { parseGraphExpression, type ParsedGraphFunction } from './graph-parser';
import { sampleParsedGraphExpression } from './graph-sampler';
import { graphWasmActive, setGraphWasmEnabled } from './graph-wasm';
await ensureGraphMath();
if (!graphWasmActive()) throw new Error('graph-eval.wasm did not load');

type Scope = { x: number; y: number; p: Record<string, number> };
type Fn = (s: Scope) => number;

const UNARY: Record<string, (v: number) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, sqrt: Math.sqrt, abs: Math.abs,
  exp: Math.exp, log: Math.log, atan: Math.atan, sinh: Math.sinh, cosh: Math.cosh,
};

/** mathjs AST → nested closures over plain numbers. The TS-only alternative. */
function closure(node: MathNode): Fn {
  const n = node as MathNode & {
    value?: number; name?: string; fn?: string | { name: string };
    args?: MathNode[]; content?: MathNode;
  };
  switch (node.type) {
    case 'ConstantNode': {
      const v = Number(n.value);
      return () => v;
    }
    case 'SymbolNode': {
      const name = n.name!;
      if (name === 'x') return (s) => s.x;
      if (name === 'y') return (s) => s.y;
      if (name === 'pi') return () => Math.PI;
      if (name === 'e') return () => Math.E;
      return (s) => s.p[name]!;
    }
    case 'ParenthesisNode':
      return closure(n.content!);
    case 'OperatorNode': {
      const [a, b] = n.args!.map(closure) as [Fn, Fn];
      switch (n.fn as string) {
        case 'add': return (s) => a(s) + b(s);
        case 'subtract': return (s) => a(s) - b(s);
        case 'multiply': return (s) => a(s) * b(s);
        case 'divide': return (s) => a(s) / b(s);
        case 'pow': return (s) => a(s) ** b(s);
        case 'unaryMinus': return (s) => -a(s);
        case 'unaryPlus': return a;
      }
      break;
    }
    case 'FunctionNode': {
      const f = UNARY[(n.fn as { name: string }).name];
      const [a] = n.args!.map(closure) as [Fn];
      if (f) return (s) => f(a(s));
      break;
    }
  }
  throw new Error(`closure compiler: unsupported ${node.toString()}`);
}

function closureEvaluator(
  source: string,
  parameters: Record<string, GraphParameter>,
): (x: number, y?: number) => number {
  const f = closure(parse(source));
  const scope: Scope = {
    x: 0,
    y: 0,
    p: Object.fromEntries(Object.entries(parameters).map(([k, v]) => [k, v.value])),
  };
  return (x, y = 0) => {
    scope.x = x;
    scope.y = y;
    return f(scope);
  };
}

const viewport: GraphViewport = { xMin: -10, xMax: 10, yMin: -7.5, yMax: 7.5 };
const param = (value: number): GraphParameter => ({ value, min: -10, max: 10, step: 0.1 });
const parameters = { a: param(0.7), b: param(1.3) };
// 800×600 px graph → the sampler's caps: 320×240 lattice, ~77k evaluations.
const options = { viewport, parameters, samples: 800, verticalSamples: 600 };

const CASES = [
  'x^2 + y^2 = 25',
  'sin(x*y) = cos(x) + a*y',
  'x^3 - 3*x*y^2 + b = sin(y)*exp(-x^2/20)',
  'y = sin(x)/x + a*x^2',
  'y = tan(x) + b*sqrt(abs(x))',
];

function evaluationSource(parsed: ParsedGraphFunction): string {
  if (parsed.kind === 'explicit') return parsed.normalized;
  const [left, right] = parsed.normalized.split('=');
  return `(${left})-(${right})`;
}

/** Throw unless all three evaluators agree, so a fast-but-wrong row can't pass. */
function assertAgree(
  label: string,
  evaluators: ((x: number, y?: number) => number)[],
): void {
  for (let i = 0; i <= 40; i += 1) {
    for (let j = 0; j <= 40; j += 1) {
      const x = -10 + i * 0.5 + 0.013;
      const y = -7.5 + j * 0.375 + 0.007;
      const [ref, ...rest] = evaluators.map((f) => f(x, y));
      for (const v of rest) {
        const same =
          (Number.isNaN(ref!) && Number.isNaN(v)) ||
          Math.abs(v - ref!) <= 1e-9 * Math.max(1, Math.abs(ref!));
        if (!same) throw new Error(`${label}: ${ref} vs ${v} at (${x}, ${y})`);
      }
    }
  }
}

for (const source of CASES) {
  const parsed = parseGraphExpression(source) as ParsedGraphFunction;
  if (!parsed.ok) throw new Error(`${source} did not parse`);
  const evalSource = evaluationSource(parsed);
  const closures: ParsedGraphFunction = {
    ...parsed,
    createEvaluator: (p) => closureEvaluator(evalSource, p),
  };
  const rust = parsed.createEvaluator(parameters);
  setGraphWasmEnabled(false);
  const mathjs = parsed.createEvaluator(parameters);
  setGraphWasmEnabled(true);
  assertAgree(source, [mathjs, rust, closures.createEvaluator(parameters)]);

  describe(`sample ${source}`, () => {
    bench('rust wasm (shipping)', () => {
      sampleParsedGraphExpression(parsed, options);
    });
    bench('mathjs (fallback)', () => {
      setGraphWasmEnabled(false);
      sampleParsedGraphExpression(parsed, options);
      setGraphWasmEnabled(true);
    });
    bench('js closures', () => {
      sampleParsedGraphExpression(closures, options);
    });
  });
}
