// Number-only build: it carries the same parser and the same real-valued
// functions, without the BigNumber/Complex/Fraction/matrix types this file has
// no use for. The one behavioural difference is that complex results
// (`sqrt(-1)`, `log(-1)`) arrive as NaN rather than a Complex — which is what
// `evaluate` below already coerced them to, so plots are unchanged.
//
// It arrives on its own chunk (see `graph-math`), so the two entry points below
// answer "still loading" until it does rather than calling `parse` too early.
import {
  graphMathReady,
  parseMath as parse,
  type MathNode,
} from './graph-math';
import type { GraphExpression, GraphParameter } from '@whiteboard/shared';
import { DEFAULT_GRAPH_PARAMETER, PARAMETRIC_VARIABLE } from './graph-defaults';
import { graphWasmProgram } from './graph-wasm';

const FUNCTION_ALIASES = new Map([
  ['sin', 'sin'],
  ['cos', 'cos'],
  ['tan', 'tan'],
  ['asin', 'asin'],
  ['arcsin', 'asin'],
  ['acos', 'acos'],
  ['arccos', 'acos'],
  ['atan', 'atan'],
  ['arctan', 'atan'],
  ['sinh', 'sinh'],
  ['cosh', 'cosh'],
  ['tanh', 'tanh'],
  ['sec', 'sec'],
  ['csc', 'csc'],
  ['cot', 'cot'],
  ['sqrt', 'sqrt'],
  ['cbrt', 'cbrt'],
  ['abs', 'abs'],
  ['sign', 'sign'],
  ['log', 'log'],
  ['ln', 'log'],
  ['exp', 'exp'],
  ['min', 'min'],
  ['max', 'max'],
  ['floor', 'floor'],
  ['ceil', 'ceil'],
  ['round', 'round'],
  ['mod', 'mod'],
]);

const UNARY = { min: 1, max: 1 } as const;

const FUNCTION_ARITY = new Map<string, { min: number; max: number }>([
  ['sin', UNARY],
  ['cos', UNARY],
  ['tan', UNARY],
  ['asin', UNARY],
  ['acos', UNARY],
  ['atan', UNARY],
  ['sinh', UNARY],
  ['cosh', UNARY],
  ['tanh', UNARY],
  ['sec', UNARY],
  ['csc', UNARY],
  ['cot', UNARY],
  ['sqrt', UNARY],
  ['cbrt', UNARY],
  ['abs', UNARY],
  ['sign', UNARY],
  ['log', { min: 1, max: 2 }],
  ['exp', UNARY],
  ['min', { min: 1, max: Number.POSITIVE_INFINITY }],
  ['max', { min: 1, max: Number.POSITIVE_INFINITY }],
  ['floor', UNARY],
  ['ceil', UNARY],
  ['round', UNARY],
  ['mod', { min: 2, max: 2 }],
]);

const BUILTIN_FUNCTION_NAMES = new Set([
  ...FUNCTION_ALIASES.keys(),
  ...FUNCTION_ALIASES.values(),
]);

const CONSTANTS = new Set(['e', 'pi']);
const RESERVED_SYMBOLS = new Set([
  'x',
  'y',
  'sum',
  'int',
  ...CONSTANTS,
  ...FUNCTION_ALIASES.keys(),
  ...FUNCTION_ALIASES.values(),
]);

const FORBIDDEN_NODE_TYPES = new Set([
  'AccessorNode',
  'ArrayNode',
  'AssignmentNode',
  'BlockNode',
  'ConditionalNode',
  'FunctionAssignmentNode',
  'IndexNode',
  'ObjectNode',
  'RangeNode',
]);

const ALLOWED_OPERATOR_NAMES = new Set([
  'add',
  'subtract',
  'multiply',
  'divide',
  'dotMultiply',
  'dotDivide',
  'pow',
  'unaryMinus',
  'unaryPlus',
  'mod',
]);

type TokenType =
  | 'number'
  | 'identifier'
  | 'constant'
  | 'function'
  | 'operator'
  | 'lparen'
  | 'rparen'
  | 'comma'
  | 'equals'
  | 'compare';

interface BasicToken {
  type: TokenType;
  value: string;
  /** `log _2(x)`'s base, added as a second argument once the call is closed. */
  base?: Token[];
}

/** A sum or an integral: an operator that binds a variable over a range. */
type AggregateKind = 'sum' | 'integral';

/**
 * The limits of a `sum_(i=1)^(5)` or an `int_0^x`, already read. What they
 * range over is the run of tokens that follows, which {@link captureAggregates}
 * claims.
 */
interface AggregateOpenToken {
  type: 'aggregate-open';
  value: string;
  kind: AggregateKind;
  /** A sum names its index in the lower limit; an integral, in its `dt`. */
  index: string | null;
  from: Token[];
  to: Token[];
}

/**
 * A sum or integral with its body claimed. It normalizes to a call on `value`,
 * which {@link installAggregates} binds into the evaluation scope — the
 * limits are the call's arguments, and the body is compiled separately so it
 * can be evaluated once per term rather than once per expression.
 */
interface AggregateToken {
  type: 'aggregate';
  value: string;
  kind: AggregateKind;
  index: string;
  from: Token[];
  to: Token[];
  body: Token[];
}

type Token = BasicToken | AggregateOpenToken | AggregateToken;

/**
 * A sum is evaluated term by term, so its length is bounded: the per-term cost
 * is what makes a curve crawl, and a sampler asks for the whole sum again at
 * every point along it.
 */
const MAX_SUM_TERMS = 200;

/** The prefix of the generated names aggregates are called by. */
const AGGREGATE_PREFIX = '_agg';

/** `r = f(θ)` reads θ, typed as `theta` (or pasted as `θ`), as its angle. */
const POLAR_VARIABLE = 'theta';

/** Highest derivative `f''(x)` a user function gets. */
const MAX_DERIVATIVE_ORDER = 2;

/** The scope name `f'(x)` (`order` primes) is called by. */
function derivativeName(name: string, order: number): string {
  return `${name}__d${order}`;
}

/** A function token's name as the user wrote it: `f__d2` reads `f''`. */
function displayFunctionName(name: string): string {
  return name.replace(/__d(\d)$/, (_, order: string) => "'".repeat(Number(order)));
}

function isAggregateName(name: string): boolean {
  return name.startsWith(AGGREGATE_PREFIX);
}

/** Hands out one name per aggregate in a single tokenize pass. */
function createAggregateNames(): { next: () => string } {
  let count = 0;
  return {
    next: () => `${AGGREGATE_PREFIX}${count++}`,
  };
}

export interface ParsedGraphFunction {
  ok: true;
  source: string;
  normalized: string;
  kind: 'explicit' | 'implicit';
  /**
   * Set on an inequality: the region where the relation compares to zero this
   * way — `y - f(x)` for an explicit one, the equation's `left - right` else.
   */
  inequality?: GraphComparison;
  variables: string[];
  /** One-off evaluation. Loops should use {@link createEvaluator} instead. */
  evaluate: (
    x: number,
    parameters: Record<string, GraphParameter>,
    y?: number,
  ) => number;
  /**
   * Bind the sliders once and get back a plain `(x, y?) => number`.
   *
   * Sampling evaluates the same expression tens of thousands of times against
   * one set of parameters; building the evaluation scope per point (which is
   * what `evaluate` does) made that allocation the second-largest cost in a
   * contour pass. Callers that loop bind once and reuse.
   */
  createEvaluator: (
    parameters: Record<string, GraphParameter>,
  ) => (x: number, y?: number) => number;
}

/** A `(a, b)` expression: a plotted point, or a curve when it uses `t`. */
export interface ParsedGraphCoordinate {
  ok: true;
  source: string;
  normalized: string;
  kind: 'point' | 'parametric';
  /** Typed as `r = f(θ)`: the domain is θ's. */
  polar?: boolean;
  variables: string[];
  evaluateAt: (
    t: number,
    parameters: Record<string, GraphParameter>,
  ) => { x: number; y: number };
  /** See {@link ParsedGraphFunction.createEvaluator}. */
  createEvaluator: (
    parameters: Record<string, GraphParameter>,
  ) => (t: number) => { x: number; y: number };
}

export type ParsedGraphExpression = ParsedGraphFunction | ParsedGraphCoordinate;

export function isCoordinateExpression(
  parsed: ParsedGraphExpression,
): parsed is ParsedGraphCoordinate {
  return parsed.kind === 'point' || parsed.kind === 'parametric';
}

export interface GraphExpressionError {
  ok: false;
  source: string;
  message: string;
}

export type GraphExpressionParseResult =
  | ParsedGraphExpression
  | GraphExpressionError;


interface GraphFunctionDefinitionSource {
  name: string;
  argument: string;
  body: string;
}

export interface GraphFunctionDefinition {
  name: string;
  argument: string;
  normalizedBody: string;
  directVariables: readonly string[];
  dependencies: readonly string[];
  evaluateRaw?: (scope: EvaluationScope) => number;
  /** Bound into the scope the body evaluates against. */
  aggregates?: readonly CompiledAggregate[];
  error?: string;
  /** Set on `f'` and `f''`: differentiated numerically from `f`. */
  derivativeOf?: string;
  order?: number;
}

export type GraphFunctionDefinitions = ReadonlyMap<
  string,
  GraphFunctionDefinition
>;

type EvaluationScope = Map<string, unknown>;

/** The definitions a graph with no `f(x) = …` rows resolves against. */
export const EMPTY_GRAPH_FUNCTIONS: GraphFunctionDefinitions = new Map();

function isNameStart(char: string): boolean {
  return /[A-Za-z_]/.test(char);
}

function isNamePart(char: string): boolean {
  return /[A-Za-z0-9_]/.test(char);
}

function isVariableName(name: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_]*$/.test(name) && !RESERVED_SYMBOLS.has(name);
}

function canEndFactor(token: Token | null): boolean {
  return (
    token?.type === 'number' ||
    token?.type === 'identifier' ||
    token?.type === 'constant' ||
    token?.type === 'aggregate' ||
    token?.type === 'rparen'
  );
}

function canStartFactor(token: Token): boolean {
  return (
    token.type === 'number' ||
    token.type === 'identifier' ||
    token.type === 'constant' ||
    token.type === 'function' ||
    token.type === 'aggregate' ||
    token.type === 'lparen'
  );
}

const SUM_LIMITS_MESSAGE = 'Sum needs limits, for example a sum from n=1 to 5';
const INTEGRAL_LIMITS_MESSAGE =
  'Integral needs limits, for example an integral from 0 to x';
const INTEGRAL_DIFFERENTIAL_MESSAGE =
  'Integral needs a differential, for example dt at the end';

function skipSpace(source: string, start: number): number {
  let index = start;
  while (index < source.length && /\s/.test(source[index]!)) index += 1;
  return index;
}

/**
 * One limit of a sum or an integral: `(i=0)`, or the bare `1` or `x` MathLive
 * writes wherever the limit is a single character.
 */
function readAggregateBound(
  source: string,
  start: number,
): { text: string; next: number } | null {
  const from = skipSpace(source, start);
  if (source[from] === '(') {
    let depth = 0;
    for (let index = from; index < source.length; index += 1) {
      if (source[index] === '(') depth += 1;
      else if (source[index] === ')') {
        depth -= 1;
        if (depth === 0) {
          return { text: source.slice(from + 1, index), next: index + 1 };
        }
      }
    }
    return null;
  }
  const match = source
    .slice(from)
    .match(/^-?(?:\d+(?:\.\d+)?|[A-Za-z][A-Za-z0-9_]*)/);
  return match ? { text: match[0], next: from + match[0].length } : null;
}

/**
 * Read `_(i=0)^(10)` — MathLive writes `\sum_{i=0}^{10}` and `\int_1^{x}` out
 * in that form, with the subscript first whichever order it was typed in.
 *
 * Both limits are expressions rather than plain numbers: a sum to `k` is what
 * makes a slider drive how many terms a series keeps, and an integral's upper
 * limit is usually `x` itself.
 */
function readAggregateLimits(
  kind: AggregateKind,
  source: string,
  start: number,
  tokenizeBound: (text: string) => Token[],
): { token: AggregateOpenToken; next: number } {
  const message = kind === 'sum' ? SUM_LIMITS_MESSAGE : INTEGRAL_LIMITS_MESSAGE;
  const underscore = skipSpace(source, start);
  if (source[underscore] !== '_') throw new Error(message);
  const lower = readAggregateBound(source, underscore + 1);
  if (!lower) throw new Error(message);
  const caret = skipSpace(source, lower.next);
  if (source[caret] !== '^') throw new Error(message);
  const upper = readAggregateBound(source, caret + 1);
  if (!upper) throw new Error(message);

  let index: string | null = null;
  let lowerText = lower.text;
  if (kind === 'sum') {
    const bound = lower.text.match(/^\s*([A-Za-z][A-Za-z0-9_]*)\s*=([\s\S]+)$/);
    if (!bound) throw new Error(message);
    index = bound[1]!;
    lowerText = bound[2]!;
    if (!isVariableName(index) || index === PARAMETRIC_VARIABLE) {
      throw new Error(`Sum index "${index}" is not allowed`);
    }
  }

  return {
    token: {
      type: 'aggregate-open',
      value: kind,
      kind,
      index,
      from: tokenizeBound(lowerText),
      to: tokenizeBound(upper.text),
    },
    next: upper.next,
  };
}

/**
 * How far a sum reaches: over the factors that follow it, stopping at the next
 * top-level `+` or `-`. `sum_(n=1)^(5)n + 1` adds 1 to the sum, matching both
 * the usual convention and Desmos.
 */
function sumBodyEnd(tokens: Token[], start: number): number {
  let depth = 0;
  for (let index = start; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.type === 'lparen') depth += 1;
    else if (token.type === 'rparen') {
      if (depth === 0) return index;
      depth -= 1;
    } else if (depth === 0) {
      if (token.type === 'equals' || token.type === 'comma') return index;
      if (
        index > start &&
        token.type === 'operator' &&
        (token.value === '+' || token.value === '-')
      ) {
        return index;
      }
    }
  }
  return tokens.length;
}

/**
 * How far an integral reaches: up to its differential, so `int_0^1 t dt + 3`
 * integrates `t` and then adds 3, and `int_0^1 t + 1 dt` integrates the sum.
 * The differential also names the variable — MathLive writes both `dt` and
 * `\mathrm{d}t` as a `d` followed by the variable.
 */
function integralBody(
  tokens: Token[],
  start: number,
): { end: number; index: string; body: Token[] } {
  let depth = 0;
  for (let index = start; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.type === 'lparen') depth += 1;
    else if (token.type === 'rparen') {
      if (depth === 0) break;
      depth -= 1;
    } else if (depth === 0 && token.type === 'equals') break;
    else if (
      depth === 0 &&
      token.type === 'identifier' &&
      token.value === 'd'
    ) {
      const variable = tokens[index + 1];
      if (variable?.type !== 'identifier') continue;
      if (!isVariableName(variable.value)) {
        throw new Error(`Integral variable "${variable.value}" is not allowed`);
      }
      return {
        end: index + 2,
        index: variable.value,
        body: tokens.slice(start, index),
      };
    }
  }
  throw new Error(INTEGRAL_DIFFERENTIAL_MESSAGE);
}

/** A limit written as a plain number, or null where it is an expression. */
function literalBound(tokens: readonly Token[]): number | null {
  const [first, second] = tokens;
  if (tokens.length === 1 && first?.type === 'number') {
    return Number(first.value);
  }
  if (
    tokens.length === 2 &&
    first?.type === 'operator' &&
    first.value === '-' &&
    second?.type === 'number'
  ) {
    return -Number(second.value);
  }
  return null;
}

/**
 * Claim each aggregate's body, leaving one token the rest of the pipeline —
 * normalizing, validating, compiling, slider discovery — reads as a call. The
 * scan runs right to left, which leaves a nested sum or integral already
 * claimed by the time the one around it looks for its own body.
 */
function captureAggregates(
  tokens: Token[],
  names: { next: () => string },
): Token[] {
  for (let position = tokens.length - 1; position >= 0; position -= 1) {
    const open = tokens[position]!;
    if (open.type !== 'aggregate-open') continue;

    let end: number;
    let index: string;
    let body: Token[];
    if (open.kind === 'sum') {
      end = sumBodyEnd(tokens, position + 1);
      body = tokens.slice(position + 1, end);
      index = open.index!;
      if (!body.length) throw new Error('Sum needs an expression to add up');
      // Limits that are already numbers are worth refusing now; a slider's are
      // only known once it has a value, and are capped there instead.
      const from = literalBound(open.from);
      const to = literalBound(open.to);
      if (from !== null && to !== null && to - from + 1 > MAX_SUM_TERMS) {
        throw new Error(`A sum is limited to ${MAX_SUM_TERMS} terms`);
      }
    } else {
      ({ end, index, body } = integralBody(tokens, position + 1));
      if (!body.length) {
        throw new Error('Integral needs an expression to integrate');
      }
    }

    tokens.splice(position, end - position, {
      type: 'aggregate',
      value: names.next(),
      kind: open.kind,
      index,
      from: open.from,
      to: open.to,
      body,
    });
  }
  return tokens;
}

/**
 * The end of one factor at `start`, or `start` where none begins there: an
 * atom, a parenthesized group or a call, with any exponent on it — `x^2` is
 * one factor, so `cos x^2` is `cos(x^2)`.
 */
function factorEnd(tokens: Token[], start: number): number {
  let index = start;
  const token = tokens[index];
  if (!token) return start;
  if (token.type === 'function') {
    // Parenthesized already, either as written or by an earlier step of the
    // right-to-left scan below.
    index += 1;
    if (tokens[index]?.type !== 'lparen') return start;
  } else if (
    token.type !== 'number' &&
    token.type !== 'identifier' &&
    token.type !== 'constant' &&
    token.type !== 'aggregate' &&
    token.type !== 'lparen'
  ) {
    return start;
  }

  if (tokens[index]?.type === 'lparen') {
    let depth = 0;
    for (; index < tokens.length; index += 1) {
      const inner = tokens[index]!;
      if (inner.type === 'lparen') depth += 1;
      else if (inner.type === 'rparen') {
        depth -= 1;
        if (depth === 0) {
          index += 1;
          break;
        }
      }
    }
    // Unbalanced: leave it alone and let mathjs report where it went wrong.
    if (depth !== 0) return start;
  } else {
    index += 1;
  }

  if (tokens[index]?.type === 'operator' && tokens[index]!.value === '^') {
    const exponent = factorEnd(tokens, index + 1);
    if (exponent > index + 1) return exponent;
  }
  return index;
}

/** How far the argument of a function written without parentheses reaches. */
function bareCallEnd(tokens: Token[], start: number): number {
  let index = start;
  let factors = 0;
  while (index < tokens.length) {
    // A second function starts a new term: `sin x cos x` is a product.
    if (tokens[index]!.type === 'function' && factors > 0) break;
    const next = factorEnd(tokens, index);
    if (next === index) break;
    factors += 1;
    index = next;
  }
  return index;
}

/**
 * Parenthesize a function written without them — `cos x`, which is what
 * MathLive writes for `\cos x`.
 *
 * The argument runs over the factors that follow, so `cos 2x` is cos(2x) while
 * `cos x + 1` adds outside. The scan runs right to left, which leaves the inner
 * call of `sin cos x` already parenthesized by the time the outer one reads it.
 */
function applyBareCalls(tokens: Token[]): Token[] {
  for (const token of tokens) {
    if (token.type !== 'aggregate') continue;
    applyBareCalls(token.from);
    applyBareCalls(token.to);
    applyBareCalls(token.body);
  }

  for (let position = tokens.length - 1; position >= 0; position -= 1) {
    const token = tokens[position]!;
    if (token.type !== 'function' || tokens[position + 1]?.type === 'lparen') {
      continue;
    }
    const end = bareCallEnd(tokens, position + 1);
    if (end === position + 1) {
      throw new Error(`Function "${token.value}" needs an argument`);
    }
    tokens.splice(end, 0, { type: 'rparen', value: ')' });
    tokens.splice(position + 1, 0, { type: 'lparen', value: '(' });
  }
  return tokens;
}

function tokenize(
  source: string,
  userFunctions: ReadonlySet<string> = new Set(),
  names: { next: () => string } = createAggregateNames(),
): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let openBars = 0;

  while (i < source.length) {
    const char = source[i]!;
    if (/\s/.test(char)) {
      i += 1;
      continue;
    }

    if (/[0-9.]/.test(char)) {
      const rest = source.slice(i);
      const match = rest.match(/^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i);
      if (!match) throw new Error(`Unexpected token "${char}"`);
      tokens.push({ type: 'number', value: match[0] });
      i += match[0].length;
      continue;
    }

    if (char === 'θ') {
      tokens.push({ type: 'identifier', value: POLAR_VARIABLE });
      i += 1;
      continue;
    }

    if (isNameStart(char)) {
      let end = i + 1;
      while (end < source.length && isNamePart(source[end]!)) end += 1;
      const rawName = source.slice(i, end);
      const name = rawName.toLowerCase();
      const nextNonSpace = source.slice(end).match(/\S/)?.[0] ?? '';
      const functionName = FUNCTION_ALIASES.get(name);


      if (name === 'sum' || name === 'int') {
        const limits = readAggregateLimits(
          name === 'sum' ? 'sum' : 'integral',
          source,
          end,
          (text) => tokenize(text, userFunctions, names),
        );
        tokens.push(limits.token);
        i = limits.next;
        continue;
      }

      // `log _2(x)`: MathLive writes a base as a subscript.
      if (functionName === 'log' && nextNonSpace === '_') {
        const base = readAggregateBound(source, source.indexOf('_', end) + 1);
        if (!base) throw new Error('Write a log base like log_2(x)');
        tokens.push({
          type: 'function',
          value: 'log',
          base: tokenize(base.text, userFunctions, names),
        });
        i = base.next;
        continue;
      }

      // `f'(x)`, which MathLive writes `f^′(x)` (and `f^(′′)(x)` twice over).
      const primes = userFunctions.has(rawName)
        ? source
            .slice(end)
            .match(/^\s*(?:\^\s*\(\s*([′']+)\s*\)|\^\s*([′']+)|([′']+))/)
        : null;
      if (primes) {
        const derived = derivativeName(
          rawName,
          (primes[1] ?? primes[2] ?? primes[3])!.length,
        );
        if (!userFunctions.has(derived)) {
          throw new Error('Only first and second derivatives can be drawn');
        }
        tokens.push({ type: 'function', value: derived });
        i = end + primes[0].length;
        continue;
      }

      if (functionName) {
        tokens.push({ type: 'function', value: functionName });
      } else if (userFunctions.has(rawName)) {
        tokens.push({
          type: nextNonSpace === '(' ? 'function' : 'identifier',
          value: rawName,
        });
      } else if (CONSTANTS.has(name)) {
        tokens.push({ type: 'constant', value: name });
      } else if (
        (name.includes('x') || name.includes('y')) &&
        /^[A-Za-z]+$/.test(rawName)
      ) {
        for (const letter of rawName) {
          const lower = letter.toLowerCase();
          tokens.push({
            type: CONSTANTS.has(lower) ? 'constant' : 'identifier',
            value: lower,
          });
        }
      } else {
        tokens.push({ type: 'identifier', value: rawName });
      }
      i = end;
      continue;
    }

    // `|x|` reads as abs(x). A bar after something that ends a factor closes
    // the innermost open one; anywhere else it opens, so `||x|-1|` nests.
    if (char === '|') {
      if (openBars > 0 && canEndFactor(tokens[tokens.length - 1] ?? null)) {
        tokens.push({ type: 'rparen', value: ')' });
        openBars -= 1;
      } else {
        tokens.push({ type: 'function', value: 'abs' });
        tokens.push({ type: 'lparen', value: '(' });
        openBars += 1;
      }
      i += 1;
      continue;
    }

    if (char === '(') tokens.push({ type: 'lparen', value: char });
    else if (char === ')') tokens.push({ type: 'rparen', value: char });
    else if (char === ',') tokens.push({ type: 'comma', value: char });
    else if (char === '=') tokens.push({ type: 'equals', value: char });
    else if ('+-*/^%'.includes(char)) {
      tokens.push({ type: 'operator', value: char });
    } else if ('<>≤≥'.includes(char)) {
      const typedEquals = (char === '<' || char === '>') && source[i + 1] === '=';
      const less = char === '<' || char === '≤';
      const orEqual = typedEquals || char === '≤' || char === '≥';
      tokens.push({
        type: 'compare',
        value: `${less ? '<' : '>'}${orEqual ? '=' : ''}`,
      });
      if (typedEquals) i += 1;
    } else {
      throw new Error(`Unexpected token "${char}"`);
    }
    i += 1;
  }

  tokens.forEach((token, index) => {
    if (
      token.type === 'function' &&
      tokens[index + 1]?.type === 'lparen' &&
      tokens[index + 2]?.type === 'rparen'
    ) {
      throw new Error(`Put a value inside ${displayFunctionName(token.value)}( )`);
    }
  });
  return attachLogBases(applyBareCalls(captureAggregates(tokens, names)));
}

/** `log _2(x)` → `log(x, 2)`, now that every call has its parentheses. */
function attachLogBases(tokens: Token[]): Token[] {
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index]!;
    if (token.type === 'aggregate') {
      attachLogBases(token.from);
      attachLogBases(token.to);
      attachLogBases(token.body);
    }
    if (token.type !== 'function' || !token.base) continue;
    let depth = 0;
    for (let close = index + 1; close < tokens.length; close += 1) {
      const type = tokens[close]!.type;
      if (type === 'lparen') depth += 1;
      else if (type === 'rparen' && --depth === 0) {
        tokens.splice(close, 0, { type: 'comma', value: ',' }, ...token.base);
        break;
      }
    }
  }
  return tokens;
}

function normalizeTokens(tokens: readonly Token[]): string {
  let normalized = '';
  let previous: Token | null = null;

  for (const token of tokens) {
    if (
      previous &&
      canEndFactor(previous) &&
      canStartFactor(token) &&
      !(previous.type === 'function' && token.type === 'lparen')
    ) {
      normalized += '*';
    }
    if (token.type === 'aggregate') {
      const from = normalizeTokens(token.from);
      const to = normalizeTokens(token.to);
      normalized += `${token.value}(${from},${to})`;
    } else {
      normalized += token.value;
    }
    previous = token;
  }

  return normalized;
}

/**
 * The two halves of a coordinate `(a, b)` — the whole expression wrapped in one
 * pair of parentheses around a single top-level comma. Null for anything else,
 * including function calls like `max(1, x)`, which open with a name token.
 */
function splitCoordinate(tokens: Token[]): [Token[], Token[]] | null {
  if (tokens[0]?.type !== 'lparen') return null;
  let depth = 0;
  let commaIndex = -1;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.type === 'lparen') depth += 1;
    else if (token.type === 'rparen') {
      depth -= 1;
      // The opening parenthesis closes early, so it doesn't wrap the whole
      // expression — `(1, 2) + 3` is arithmetic, not a coordinate.
      if (depth === 0 && index !== tokens.length - 1) return null;
    } else if (token.type === 'comma' && depth === 1) {
      if (commaIndex !== -1) return null;
      commaIndex = index;
    }
  }

  if (depth !== 0 || commaIndex === -1) return null;
  const x = tokens.slice(1, commaIndex);
  const y = tokens.slice(commaIndex + 1, tokens.length - 1);
  return x.length && y.length ? [x, y] : null;
}

function containsY(tokens: readonly Token[]): boolean {
  return tokens.some(
    (token) =>
      (token.type === 'identifier' && token.value === 'y') ||
      (token.type === 'aggregate' &&
        (containsY(token.from) ||
          containsY(token.to) ||
          containsY(token.body))),
  );
}

/**
 * Split on the equals signs. Tokenizing first rather than splitting the raw
 * text keeps the `=` inside a sum's lower limit out of the count — by this
 * point it has been consumed into the sum's expansion.
 */
function splitOnEquals(tokens: Token[]): Token[][] {
  const sides: Token[][] = [[]];
  for (const token of tokens) {
    if (token.type === 'equals') sides.push([]);
    else sides[sides.length - 1]!.push(token);
  }
  return sides;
}

/**
 * The normalized expression, with the tokens it was written from: an explicit
 * `y = …` drops the `y` side, and those tokens are where the compiled sums
 * and integrals are collected from.
 */
function normalizeGraphSides(sides: Token[][]): {
  normalized: string;
  tokens: Token[];
} {
  if (sides.length > 2) throw new Error('Use a single equals sign');
  if (sides.length === 1) {
    return { normalized: normalizeTokens(sides[0]!), tokens: sides[0]! };
  }

  const left = normalizeTokens(sides[0]!);
  const right = normalizeTokens(sides[1]!);
  if (!left || !right) throw new Error('Enter both sides of the equation');

  // Keep ordinary functions on the cheaper, higher-resolution 1D sampler.
  if (left === 'y' && !containsY(sides[1]!)) {
    return { normalized: right, tokens: sides[1]! };
  }
  if (right === 'y' && !containsY(sides[0]!)) {
    return { normalized: left, tokens: sides[0]! };
  }
  return {
    normalized: `${left}=${right}`,
    tokens: [...sides[0]!, ...sides[1]!],
  };
}

export function normalizeGraphExpression(
  source: string,
  definitions: GraphFunctionDefinitions = EMPTY_GRAPH_FUNCTIONS,
): string {
  const userFunctions = new Set(definitions.keys());
  return normalizeGraphSides(
    splitOnEquals(tokenize(source.trim(), userFunctions)),
  ).normalized;
}

function symbolName(node: MathNode | undefined): string | null {
  if (!node) return null;
  const candidate = node as MathNode & { name?: unknown };
  return typeof candidate.name === 'string' ? candidate.name : null;
}

function operatorName(node: MathNode): string | null {
  const candidate = node as MathNode & { fn?: unknown };
  return typeof candidate.fn === 'string' ? candidate.fn : null;
}

function validateStructureNode(
  node: MathNode,
  userFunctions: ReadonlySet<string> = new Set(),
): void {
  if (FORBIDDEN_NODE_TYPES.has(node.type)) {
    throw new Error(`${node.type.replace('Node', '').toLowerCase()} is not allowed`);
  }
  if (node.type === 'OperatorNode') {
    const fn = operatorName(node);
    if (!fn || !ALLOWED_OPERATOR_NAMES.has(fn)) {
      throw new Error('Only arithmetic operators are allowed');
    }
  }
  if (node.type === 'FunctionNode') {
    const name = symbolName((node as MathNode & { fn?: MathNode }).fn as MathNode);
    // A sum or integral: `captureAggregates` wrote the call, and both of its
    // arguments are the limits it read.
    if (name && isAggregateName(name)) return;
    const canonicalName = name ? (FUNCTION_ALIASES.get(name) ?? name) : null;
    const arity = canonicalName ? FUNCTION_ARITY.get(canonicalName) : undefined;
    const isUserFunction = name ? userFunctions.has(name) : false;
    if (!arity && !isUserFunction) {
      throw new Error(`Function "${name ?? '?'}" is not allowed`);
    }
    const args = (node as MathNode & { args?: unknown[] }).args;
    const count = Array.isArray(args) ? args.length : 0;
    const expected = arity ?? UNARY;
    if (count < expected.min || count > expected.max) {
      throw new Error(
        `Function "${name}" expects ${
          expected.min === expected.max
            ? expected.min
            : `${expected.min}-${expected.max}`
        } argument${expected.max === 1 ? '' : 's'}`,
      );
    }
  }
}

function functionDefinitionSource(
  source: string,
): GraphFunctionDefinitionSource | null {
  const match = source.match(
    /^\s*([A-Za-z][A-Za-z0-9_]*)\s*\(\s*([A-Za-z][A-Za-z0-9_]*)\s*\)\s*=\s*(.+?)\s*$/,
  );
  // `sin(x) = y` is an equation, not a redefinition of sin.
  if (!match || BUILTIN_FUNCTION_NAMES.has(match[1]!.toLowerCase())) return null;
  return { name: match[1]!, argument: match[2]!, body: match[3]! };
}

function isValidFunctionName(name: string): boolean {
  return (
    /^[A-Za-z][A-Za-z0-9_]*$/.test(name) &&
    name !== PARAMETRIC_VARIABLE &&
    !RESERVED_SYMBOLS.has(name.toLowerCase())
  );
}

function isFunctionSymbol(
  name: string,
  node: MathNode,
  parent: MathNode | null,
  userFunctions: ReadonlySet<string>,
): boolean {
  if (!BUILTIN_FUNCTION_NAMES.has(name) && !userFunctions.has(name)) {
    return false;
  }
  const functionParent = parent as (MathNode & { fn?: MathNode }) | null;
  if (functionParent?.type === 'FunctionNode' && functionParent.fn === node) {
    return true;
  }
  throw new Error(`Function "${name}" must be called`);
}

function functionNodeName(node: MathNode): string | null {
  if (node.type !== 'FunctionNode') return null;
  return symbolName((node as MathNode & { fn?: MathNode }).fn as MathNode);
}

function compileGraphFunctionDefinition(
  source: GraphFunctionDefinitionSource,
  userFunctions: ReadonlySet<string>,
): GraphFunctionDefinition {
  if (!isValidFunctionName(source.name)) {
    throw new Error(`Function name "${source.name}" is reserved`);
  }
  if (
    !/^[A-Za-z][A-Za-z0-9_]*$/.test(source.argument) ||
    CONSTANTS.has(source.argument.toLowerCase()) ||
    BUILTIN_FUNCTION_NAMES.has(source.argument.toLowerCase()) ||
    userFunctions.has(source.argument)
  ) {
    throw new Error(`Function argument "${source.argument}" is not allowed`);
  }

  const bodyTokens = tokenize(source.body.trim(), userFunctions);
  const normalizedBody = normalizeTokens(bodyTokens);
  if (!normalizedBody) throw new Error('Enter a function body');
  const directVariables = new Set<string>();
  const dependencies = new Set<string>();

  const visit: SymbolVisitor = (node, parent) => {
    validateStructureNode(node, userFunctions);
    const calledFunction = functionNodeName(node);
    if (calledFunction && userFunctions.has(calledFunction)) {
      dependencies.add(calledFunction);
    }
    if (node.type !== 'SymbolNode') return;
    const name = symbolName(node);
    if (!name) throw new Error('Invalid symbol');
    if (isAggregateName(name)) return;
    if (name === source.argument || CONSTANTS.has(name)) return;
    if (isFunctionSymbol(name, node, parent, userFunctions)) return;
    if (name === 'x' || name === 'y' || name === PARAMETRIC_VARIABLE) {
      throw new Error(
        `Use ${source.argument} as the input to ${source.name}(${source.argument})`,
      );
    }
    if (!isVariableName(name)) {
      throw new Error(`Variable "${name}" is not allowed`);
    }
    directVariables.add(name);
  };

  const evaluateRaw = compileNormalized(normalizedBody, visit);
  const aggregates = compileAggregates(bodyTokens, visit);
  return {
    name: source.name,
    argument: source.argument,
    normalizedBody,
    directVariables: [...directVariables].sort((a, b) => a.localeCompare(b)),
    dependencies: [...dependencies].sort((a, b) => a.localeCompare(b)),
    aggregates,
    evaluateRaw,
  };
}

/**
 * Least-recently-used eviction over an insertion-ordered Map: a hit is moved to
 * the end, and the oldest key is dropped once the map is over `limit`.
 */
function cacheGet<T>(cache: Map<string, T>, key: string): T | undefined {
  const hit = cache.get(key);
  if (hit === undefined) return undefined;
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

function cacheSet<T>(cache: Map<string, T>, key: string, value: T, limit: number): T {
  cache.set(key, value);
  if (cache.size > limit) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return value;
}

const DEFINITIONS_CACHE_LIMIT = 32;
const definitionsCache = new Map<string, GraphFunctionDefinitions>();
// Identifies the definitions a parse was resolved against, so parse results
// keyed on it stay correct when a user function's body changes.
const definitionSignatures = new WeakMap<GraphFunctionDefinitions, string>();

function definitionSignature(definitions: GraphFunctionDefinitions): string {
  return definitionSignatures.get(definitions) ?? '';
}

/**
 * Compile the `f(x) = …` definitions among `expressions`.
 *
 * Cached on the definition sources, so an unrelated edit (a color, the
 * viewport, another curve) hands back the same map instance — which is what
 * lets {@link parseGraphExpression} reuse its own cached results downstream.
 */
export function createGraphFunctionDefinitions(
  expressions: readonly GraphExpression[],
): GraphFunctionDefinitions {
  // Without the parser there is nothing to compile these into, and an empty
  // map is what a graph with no `f(x) = …` rows resolves against anyway. Not
  // cached: the real definitions have to be built once the chunk lands.
  if (!graphMathReady()) return EMPTY_GRAPH_FUNCTIONS;

  const sources = new Map<string, GraphFunctionDefinitionSource>();
  for (const expression of expressions) {
    const source = functionDefinitionSource(expression.expression);
    if (source && isValidFunctionName(source.name)) {
      sources.set(source.name, source);
    }
  }

  const signature = [...sources.values()]
    .map((source) => `${source.name}(${source.argument})=${source.body}`)
    .join('\u0000');
  if (!signature) return EMPTY_GRAPH_FUNCTIONS;
  const cached = cacheGet(definitionsCache, signature);
  if (cached) return cached;

  const userFunctions = withDerivatives(sources.keys());
  const definitions = new Map<string, GraphFunctionDefinition>();
  for (const source of sources.values()) {
    try {
      definitions.set(
        source.name,
        compileGraphFunctionDefinition(source, userFunctions),
      );
    } catch (error) {
      definitions.set(source.name, {
        name: source.name,
        argument: source.argument,
        normalizedBody: '',
        directVariables: [],
        dependencies: [],
        error: error instanceof Error ? error.message : 'Invalid function',
      });
    }
    for (let order = 1; order <= MAX_DERIVATIVE_ORDER; order += 1) {
      definitions.set(derivativeName(source.name, order), {
        name: derivativeName(source.name, order),
        argument: source.argument,
        normalizedBody: '',
        directVariables: [],
        dependencies: [source.name],
        derivativeOf: source.name,
        order,
      });
    }
  }
  definitionSignatures.set(definitions, signature);
  return cacheSet(
    definitionsCache,
    signature,
    definitions,
    DEFINITIONS_CACHE_LIMIT,
  );
}

function addDefinitionVariables(
  name: string,
  definitions: GraphFunctionDefinitions,
  variables: Set<string>,
  visiting = new Set<string>(),
): void {
  const definition = definitions.get(name);
  if (!definition) throw new Error(`Function "${name}" is not defined`);
  if (definition.error || (!definition.evaluateRaw && !definition.derivativeOf)) {
    throw new Error(
      `Function "${name}" is invalid${definition.error ? `: ${definition.error}` : ''}`,
    );
  }
  if (visiting.has(name)) {
    throw new Error(`Circular function definition involving "${name}"`);
  }

  visiting.add(name);
  for (const variable of definition.directVariables) variables.add(variable);
  for (const dependency of definition.dependencies) {
    addDefinitionVariables(dependency, definitions, variables, visiting);
  }
  visiting.delete(name);
}

type SymbolVisitor = (node: MathNode, parent: MathNode | null) => void;

/** Parse, validate and compile one normalized expression. */
function compileNormalized(
  normalized: string,
  visit: SymbolVisitor,
): (scope: EvaluationScope) => number {
  const root = parse(normalized);
  root.traverse((node, _path, parent) => visit(node, parent));
  const compiled = root.compile();
  return (scope) => {
    try {
      const value = compiled.evaluate(scope);
      return typeof value === 'number' ? value : Number.NaN;
    } catch {
      return Number.NaN;
    }
  };
}

interface CompiledAggregate {
  name: string;
  kind: AggregateKind;
  index: string;
  body: (scope: EvaluationScope) => number;
}

/**
 * Compile each body in its lexical scope. An index binds only its body, not
 * its limits, sibling aggregates, or the expression surrounding the aggregate.
 * Nested calls retain the outer indices while adding their own body binding.
 */
function compileAggregates(
  tokens: readonly Token[],
  visit: SymbolVisitor,
  bound: ReadonlySet<string> = new Set(),
): CompiledAggregate[] {
  const compiled: CompiledAggregate[] = [];
  for (const token of tokens) {
    if (token.type !== 'aggregate') continue;
    const bodyBound = new Set([...bound, token.index]);
    const visitBody: SymbolVisitor = (node, parent) => {
      if (node.type === 'SymbolNode' && bodyBound.has(symbolName(node)!)) return;
      visit(node, parent);
    };
    compiled.push({
      name: token.value,
      kind: token.kind,
      index: token.index,
      body: compileNormalized(normalizeTokens(token.body), visitBody),
    });
    compiled.push(...compileAggregates(token.from, visit, bound));
    compiled.push(...compileAggregates(token.to, visit, bound));
    compiled.push(...compileAggregates(token.body, visit, bodyBound));
  }
  return compiled;
}

function sumSeries(
  aggregate: CompiledAggregate,
  from: number,
  to: number,
  scope: EvaluationScope,
): number {
  // A slider is the point of a variable limit, and its step is 0.1 by default,
  // so a sum to `k` follows `k` to the nearest whole number rather than
  // refusing every value between two of them.
  const first = Math.round(from);
  const last = Math.round(to);
  if (last < first) return 0;
  if (last - first + 1 > MAX_SUM_TERMS) return Number.NaN;

  let total = 0;
  for (let index = first; index <= last; index += 1) {
    scope.set(aggregate.index, index);
    total += aggregate.body(scope);
  }
  return total;
}

/** Simpson's rule over one interval, from its ends and its midpoint. */
function simpson(
  a: number,
  b: number,
  fa: number,
  fm: number,
  fb: number,
): number {
  return ((b - a) / 6) * (fa + 4 * fm + fb);
}

/** How close an integral is taken, relative to its own size. */
const INTEGRAL_TOLERANCE = 1e-8;
/**
 * Bounds on subdivision. A curve asks for the whole integral again at every
 * point along it, so a single one cannot be allowed to run away: past these it
 * keeps the estimate it has rather than refining further.
 */
const INTEGRAL_MAX_DEPTH = 10;
const INTEGRAL_MAX_SAMPLES = 800;

/**
 * Adaptive Simpson: halve an interval until the two halves agree with the
 * whole, which spends samples on the parts of the integrand that bend and
 * leaves the flat parts alone.
 */
function integrate(
  aggregate: CompiledAggregate,
  from: number,
  to: number,
  scope: EvaluationScope,
): number {
  if (from === to) return 0;

  let budget = INTEGRAL_MAX_SAMPLES;
  const at = (t: number): number => {
    budget -= 1;
    scope.set(aggregate.index, t);
    return aggregate.body(scope);
  };

  const refine = (
    a: number,
    b: number,
    fa: number,
    fm: number,
    fb: number,
    whole: number,
    tolerance: number,
    depth: number,
  ): number => {
    const m = (a + b) / 2;
    const flm = at((a + m) / 2);
    const frm = at((m + b) / 2);
    const left = simpson(a, m, fa, flm, fm);
    const right = simpson(m, b, fm, frm, fb);
    const delta = left + right - whole;
    // A pole, or a point the integrand is undefined at. Halving it only
    // multiplies the cost — the answer is undefined either way.
    if (!Number.isFinite(delta)) return Number.NaN;
    if (depth <= 0 || budget <= 0 || Math.abs(delta) <= 15 * tolerance) {
      return left + right + delta / 15;
    }
    return (
      refine(a, m, fa, flm, fm, left, tolerance / 2, depth - 1) +
      refine(m, b, fm, frm, fb, right, tolerance / 2, depth - 1)
    );
  };

  const fa = at(from);
  const fm = at((from + to) / 2);
  const fb = at(to);
  const whole = simpson(from, to, fa, fm, fb);
  const tolerance = INTEGRAL_TOLERANCE * (1 + Math.abs(whole));
  return refine(from, to, fa, fm, fb, whole, tolerance, INTEGRAL_MAX_DEPTH);
}

/**
 * Run one sum or integral, with its variable bound in the scope around it.
 *
 * Binding into the shared scope rather than a copy is what makes nesting work:
 * the body sees `x`, the sliders and any enclosing index, and restoring the
 * outer value on the way out is what lets an inner sum shadow an outer one.
 */
function evaluateAggregate(
  aggregate: CompiledAggregate,
  from: unknown,
  to: unknown,
  scope: EvaluationScope,
): number {
  if (
    typeof from !== 'number' ||
    typeof to !== 'number' ||
    !Number.isFinite(from) ||
    !Number.isFinite(to)
  ) {
    return Number.NaN;
  }

  const bound = scope.has(aggregate.index);
  const outer = scope.get(aggregate.index);
  try {
    return aggregate.kind === 'sum'
      ? sumSeries(aggregate, from, to, scope)
      : integrate(aggregate, from, to, scope);
  } finally {
    if (bound) scope.set(aggregate.index, outer);
    else scope.delete(aggregate.index);
  }
}

function installAggregates(
  scope: EvaluationScope,
  aggregates: readonly CompiledAggregate[],
): void {
  for (const aggregate of aggregates) {
    scope.set(aggregate.name, (from: unknown, to: unknown) =>
      evaluateAggregate(aggregate, from, to, scope),
    );
  }
}

type BoundGraphFunctions = ReadonlyMap<string, (input: unknown) => number>;

/** `names` plus the `f'` and `f''` every user function comes with. */
function withDerivatives(names: Iterable<string>): Set<string> {
  const all = new Set<string>();
  for (const name of names) {
    all.add(name);
    for (let order = 1; order <= MAX_DERIVATIVE_ORDER; order += 1) {
      all.add(derivativeName(name, order));
    }
  }
  return all;
}

/**
 * Central differences. The step balances truncation against rounding error:
 * about eps^(1/3) of the scale for a first derivative, eps^(1/4) for a second.
 */
function differentiate(
  f: (input: unknown) => number,
  x: number,
  order: number,
): number {
  const scale = Math.max(1, Math.abs(x));
  if (order === 1) {
    const h = 6e-6 * scale;
    return (f(x + h) - f(x - h)) / (2 * h);
  }
  const h = 1e-4 * scale;
  return (f(x + h) - 2 * f(x) + f(x - h)) / (h * h);
}

/** Set each slider variable and each user function into `scope`. */
function fillScope(
  scope: EvaluationScope,
  parameters: Record<string, GraphParameter>,
  variables: Iterable<string>,
  functions: BoundGraphFunctions,
): void {
  for (const variable of variables) {
    scope.set(
      variable,
      parameters[variable]?.value ?? DEFAULT_GRAPH_PARAMETER.value,
    );
  }
  for (const [name, fn] of functions) scope.set(name, fn);
}

/**
 * Bind every user function to one set of slider values.
 *
 * Each function builds its scope once, on first call, and a call after that
 * only rewrites its argument. Built per call instead, a curve through `f(x)`
 * paid for a fresh scope, a closure per definition and a recursion set at
 * every sample — about double the cost of the same expression written inline.
 *
 * `busy` stands in for the old per-call recursion set. Parsing already rejects
 * circular definitions, so re-entering a function mid-call is the one case it
 * has to catch, and it answers NaN as before.
 */
function bindGraphFunctions(
  parameters: Record<string, GraphParameter>,
  definitions: GraphFunctionDefinitions,
): BoundGraphFunctions {
  const bound = new Map<string, (input: unknown) => number>();
  for (const definition of definitions.values()) {
    const { derivativeOf, order } = definition;
    if (derivativeOf && order) {
      bound.set(definition.name, (input) =>
        typeof input === 'number'
          ? differentiate(bound.get(derivativeOf)!, input, order)
          : Number.NaN,
      );
      continue;
    }
    const { evaluateRaw } = definition;
    if (!evaluateRaw || definition.error) {
      bound.set(definition.name, () => Number.NaN);
      continue;
    }
    // Lazy: the scope holds every bound function, so it can't be built until
    // this loop has finished filling `bound`.
    let scope: EvaluationScope | null = null;
    let busy = false;
    bound.set(definition.name, (input) => {
      if (typeof input !== 'number' || busy) return Number.NaN;
      if (!scope) {
        scope = new Map();
        fillScope(scope, parameters, definition.directVariables, bound);
        installAggregates(scope, definition.aggregates ?? []);
      }
      scope.set(definition.argument, input);
      busy = true;
      try {
        return evaluateRaw(scope);
      } finally {
        busy = false;
      }
    });
  }
  return bound;
}

/**
 * Build the scope a compiled expression evaluates against.
 *
 * A `Map` rather than a plain object because that is what mathjs consumes
 * natively — handed an object it wraps it in a Map-like adapter on every single
 * `evaluate` call, which measured ~45% slower across a contour pass.
 */
function createEvaluationScope(
  values: Record<string, number>,
  parameters: Record<string, GraphParameter>,
  variables: Iterable<string>,
  definitions: GraphFunctionDefinitions,
): EvaluationScope {
  const scope: EvaluationScope = new Map(Object.entries(values));
  fillScope(
    scope,
    parameters,
    variables,
    bindGraphFunctions(parameters, definitions),
  );
  return scope;
}

type CompiledSide = {
  normalized: string;
  evaluate: (scope: EvaluationScope) => number;
  aggregates: CompiledAggregate[];
  usesParameter: boolean;
};

function compileCoordinateSide(
  tokens: Token[],
  variables: Set<string>,
  definitions: GraphFunctionDefinitions,
): CompiledSide {
  const normalized = normalizeTokens(tokens);
  let usesParameter = false;
  const userFunctions = new Set(definitions.keys());
  const dependencies = new Set<string>();

  const visit: SymbolVisitor = (node, parent) => {
    validateStructureNode(node, userFunctions);
    const calledFunction = functionNodeName(node);
    if (calledFunction && userFunctions.has(calledFunction)) {
      dependencies.add(calledFunction);
    }
    if (node.type !== 'SymbolNode') return;
    const name = symbolName(node);
    if (!name) throw new Error('Invalid symbol');
    if (isAggregateName(name)) return;
    if (CONSTANTS.has(name)) return;
    if (name === PARAMETRIC_VARIABLE) {
      usesParameter = true;
      return;
    }
    if (name === 'x' || name === 'y') {
      throw new Error('Coordinates vary with t, for example (cos(t), sin(t))');
    }
    if (isFunctionSymbol(name, node, parent, userFunctions)) return;
    if (!isVariableName(name)) {
      throw new Error(`Variable "${name}" is not allowed`);
    }
    variables.add(name);
  };

  const evaluate = compileNormalized(normalized, visit);
  const compiled = compileAggregates(tokens, visit);
  for (const dependency of dependencies) {
    addDefinitionVariables(dependency, definitions, variables);
  }

  return { normalized, usesParameter, aggregates: compiled, evaluate };
}

function parseCoordinateExpression(
  source: string,
  [xTokens, yTokens]: [Token[], Token[]],
  definitions: GraphFunctionDefinitions,
): ParsedGraphCoordinate {
  const variables = new Set<string>();
  const xSide = compileCoordinateSide(xTokens, variables, definitions);
  const ySide = compileCoordinateSide(yTokens, variables, definitions);

  const createEvaluator = (parameters: Record<string, GraphParameter>) => {
    const scope = createEvaluationScope(
      { [PARAMETRIC_VARIABLE]: 0 },
      parameters,
      variables,
      definitions,
    );
    installAggregates(scope, [...xSide.aggregates, ...ySide.aggregates]);
    return (t: number) => {
      scope.set(PARAMETRIC_VARIABLE, t);
      return { x: xSide.evaluate(scope), y: ySide.evaluate(scope) };
    };
  };

  return {
    ok: true,
    source,
    normalized: `(${xSide.normalized},${ySide.normalized})`,
    kind: xSide.usesParameter || ySide.usesParameter ? 'parametric' : 'point',
    variables: [...variables].sort((a, b) => a.localeCompare(b)),
    evaluateAt: (t, parameters) => createEvaluator(parameters)(t),
    createEvaluator,
  };
}

function parseFunctionDefinitionExpression(
  source: string,
  definitionSource: GraphFunctionDefinitionSource,
  definitions: GraphFunctionDefinitions,
): ParsedGraphFunction {
  const userFunctions = new Set(definitions.keys());
  userFunctions.add(definitionSource.name);
  const definition = compileGraphFunctionDefinition(
    definitionSource,
    userFunctions,
  );
  const localDefinitions = new Map(definitions);
  localDefinitions.set(definition.name, definition);
  const variables = new Set<string>();
  addDefinitionVariables(definition.name, localDefinitions, variables);

  const createEvaluator = (parameters: Record<string, GraphParameter>) =>
    bindGraphFunctions(parameters, localDefinitions).get(definition.name)!;

  return {
    ok: true,
    source,
    normalized: `${definition.name}(${definition.argument})=${definition.normalizedBody}`,
    kind: 'explicit',
    variables: [...variables].sort((a, b) => a.localeCompare(b)),
    evaluate: (x, parameters) => createEvaluator(parameters)(x),
    createEvaluator,
  };
}

const PARSE_CACHE_LIMIT = 256;
const parseCache = new Map<string, GraphExpressionParseResult>();

/**
 * Parse an expression into something samplable, or an error to show on the row.
 *
 * Results are cached on the source text and the definitions it resolves
 * against. Parsing compiles a mathjs tree, and the renderer, the panel and the
 * intersection finder all ask for the same expression on every render — without
 * the cache each of them rebuilt that tree and threw it away.
 */
export function parseGraphExpression(
  source: string,
  definitions: GraphFunctionDefinitions = EMPTY_GRAPH_FUNCTIONS,
): GraphExpressionParseResult {
  // Deliberately ahead of the cache, and never cached itself: this answer is
  // about the parser's arrival, not about `source`, and it stops being true.
  if (!graphMathReady()) {
    return { ok: false, source, message: 'Loading the graph parser…' };
  }

  const key = `${definitionSignature(definitions)}\u0000${source}`;
  const cached = cacheGet(parseCache, key);
  if (cached) return cached;
  return cacheSet(
    parseCache,
    key,
    parseGraphExpressionUncached(source, definitions),
    PARSE_CACHE_LIMIT,
  );
}

/** mathjs reports positions in the rewritten text, which the user never sees. */
function friendlyMessage(message: string): string {
  const plain = message.replace(/\s*\(char \d+\)$/, '');
  if (plain.startsWith('Unexpected end of expression')) {
    return 'The expression is unfinished';
  }
  if (plain.startsWith('Parenthesis ) expected')) return 'A bracket is never closed';
  if (plain.startsWith('Value expected')) return 'A value is missing';
  const misplaced = plain.match(/^(?:Unexpected operator|Unexpected token) "?(.+?)"?$/);
  if (misplaced) return `"${misplaced[1]}" is out of place`;
  return plain;
}

export type GraphComparison = '<' | '<=' | '>' | '>=';

/** Whether `value` compares to zero as `op` says. NaN satisfies nothing. */
export function satisfies(value: number, op: GraphComparison): boolean {
  if (op === '<') return value < 0;
  if (op === '<=') return value <= 0;
  if (op === '>') return value > 0;
  return value >= 0;
}

const FLIPPED: Record<GraphComparison, GraphComparison> = {
  '<': '>',
  '<=': '>=',
  '>': '<',
  '>=': '<=',
};

/**
 * Peel the `{x > 0}` restrictions off the end of an expression. MathLive
 * writes `\{x>0\}` for braces typed as a pair, `{x>0}` otherwise.
 */
function splitRestrictions(source: string): {
  body: string;
  restrictions: string[];
} {
  const restrictions: string[] = [];
  let body = source;
  for (;;) {
    const match = body.match(/\\?\{([^{}]*?)\\?\}\s*$/);
    if (!match) return { body: body.trim(), restrictions };
    restrictions.unshift(match[1]!);
    body = body.slice(0, match.index);
  }
}

function splitOnComparison(tokens: Token[]): {
  sides: Token[][];
  ops: GraphComparison[];
} {
  const sides: Token[][] = [[]];
  const ops: GraphComparison[] = [];
  for (const token of tokens) {
    if (token.type === 'compare') {
      ops.push(token.value as GraphComparison);
      sides.push([]);
    } else {
      sides[sides.length - 1]!.push(token);
    }
  }
  return { sides, ops };
}

/**
 * `r = f(θ)` as the curve it traces, `(f(t) cos t, f(t) sin t)`, so it
 * samples, takes a domain and finds its sliders like any parametric curve.
 */
function polarCoordinates(tokens: Token[]): [Token[], Token[]] | null {
  const sides = splitOnEquals(tokens);
  if (sides.length !== 2) return null;
  const [left, right] = sides as [Token[], Token[]];
  if (left.length !== 1 || left[0]!.type !== 'identifier' || left[0]!.value !== 'r') {
    return null;
  }
  const inXY = right.some(
    (token) =>
      token.type === 'identifier' && (token.value === 'x' || token.value === 'y'),
  );
  if (inXY) return null;
  const t: Token = { type: 'identifier', value: PARAMETRIC_VARIABLE };
  const radius: Token[] = [
    { type: 'lparen', value: '(' },
    ...right.map((token) =>
      token.type === 'identifier' && token.value === POLAR_VARIABLE ? t : token,
    ),
    { type: 'rparen', value: ')' },
  ];
  const angle = (fn: string): Token[] => [
    { type: 'function', value: fn },
    { type: 'lparen', value: '(' },
    t,
    { type: 'rparen', value: ')' },
  ];
  return [
    [...radius, ...angle('cos')],
    [...radius, ...angle('sin')],
  ];
}

type RelationEvaluator = (
  parameters: Record<string, GraphParameter>,
) => (x: number, y: number) => number;

/**
 * Compile one scalar expression in x (and y, when `allowY`), adding the
 * sliders it reads to `variables`. A self-contained expression runs in Rust;
 * sums, integrals and user functions live in the mathjs scope.
 */
function compileRelation(
  evaluationSource: string,
  tokens: readonly Token[],
  allowY: boolean,
  definitions: GraphFunctionDefinitions,
  variables: Set<string>,
): RelationEvaluator {
  const userFunctions = new Set(definitions.keys());
  const names = new Set<string>();
  const dependencies = new Set<string>();
  const visit: SymbolVisitor = (node, parent) => {
    validateStructureNode(node, userFunctions);
    const calledFunction = functionNodeName(node);
    if (calledFunction && userFunctions.has(calledFunction)) {
      dependencies.add(calledFunction);
    }
    if (node.type !== 'SymbolNode') return;
    const name = symbolName(node);
    if (!name) throw new Error('Invalid symbol');
    if (isAggregateName(name)) return;
    if (name === 'x' || (allowY && name === 'y') || CONSTANTS.has(name)) return;
    if (name === 'y') {
      throw new Error('Use y in an equation, for example x^2 + y^2 = 1');
    }
    if (isFunctionSymbol(name, node, parent, userFunctions)) return;
    if (!isVariableName(name)) {
      throw new Error(`Variable "${name}" is not allowed`);
    }
    names.add(name);
  };
  const evaluateExpression = compileNormalized(evaluationSource, visit);
  const aggregates = compileAggregates(tokens, visit);
  for (const dependency of dependencies) {
    addDefinitionVariables(dependency, definitions, names);
  }
  for (const name of names) variables.add(name);
  const rust =
    aggregates.length === 0 && dependencies.size === 0
      ? graphWasmProgram(evaluationSource, [...names])
      : null;
  return (parameters) => {
    const fast = rust?.bind(parameters);
    if (fast) return fast;
    const scope = createEvaluationScope({ x: 0, y: 0 }, parameters, names, definitions);
    installAggregates(scope, aggregates);
    return (x, y) => {
      scope.set('x', x);
      scope.set('y', y);
      return evaluateExpression(scope);
    };
  };
}

/** `0 < x < 2` as the pair `0 - x < 0` and `x - 2 < 0`. */
function compileRestriction(
  text: string,
  definitions: GraphFunctionDefinitions,
  variables: Set<string>,
): { evaluate: RelationEvaluator; op: GraphComparison }[] {
  const { sides, ops } = splitOnComparison(
    tokenize(text.trim(), new Set(definitions.keys())),
  );
  if (ops.length === 0) {
    throw new Error('A restriction needs a comparison, like {x > 0}');
  }
  return ops.map((op, index) => {
    const leftTokens = sides[index]!;
    const rightTokens = sides[index + 1]!;
    const left = normalizeTokens(leftTokens);
    const right = normalizeTokens(rightTokens);
    if (!left || !right) throw new Error('Enter both sides of the restriction');
    return {
      op,
      evaluate: compileRelation(
        `(${left})-(${right})`,
        [...leftTokens, ...rightTokens],
        true,
        definitions,
        variables,
      ),
    };
  });
}

function parseGraphExpressionUncached(
  source: string,
  definitions: GraphFunctionDefinitions,
): GraphExpressionParseResult {
  const trimmed = source.trim();
  if (!trimmed) return { ok: false, source, message: 'Enter an expression' };

  try {
    const definition = functionDefinitionSource(trimmed);
    if (definition) {
      return parseFunctionDefinitionExpression(source, definition, definitions);
    }
    const { body, restrictions } = splitRestrictions(trimmed);
    if (!body) return { ok: false, source, message: 'Enter an expression' };
    const tokens = tokenize(body, new Set(definitions.keys()));

    const coordinate = body.startsWith('(') ? splitCoordinate(tokens) : null;
    const polar = coordinate ? null : polarCoordinates(tokens);
    if (coordinate || polar) {
      if (restrictions.length > 0) {
        throw new Error('Restrictions like {x > 0} work on curves in x and y');
      }
      const parsed = parseCoordinateExpression(source, (coordinate ?? polar)!, definitions);
      return polar ? { ...parsed, polar: true } : parsed;
    }

    let kind: 'explicit' | 'implicit';
    let normalized: string;
    let evaluationSource: string;
    let relationTokens: Token[];
    let inequality: GraphComparison | undefined;
    const { sides, ops } = splitOnComparison(tokens);
    if (ops.length > 0) {
      if (ops.length > 1) {
        throw new Error('Use one inequality sign, or a restriction like {0 < x < 2}');
      }
      if (tokens.some((token) => token.type === 'equals')) {
        throw new Error('Use either = or an inequality sign');
      }
      const [leftTokens, rightTokens] = sides as [Token[], Token[]];
      const left = normalizeTokens(leftTokens);
      const right = normalizeTokens(rightTokens);
      if (!left || !right) throw new Error('Enter both sides of the inequality');
      const op = ops[0]!;
      normalized = `${left}${op}${right}`;
      // `y < g(x)` keeps g on the explicit sampler; the region is then
      // `y - g(x) < 0`.
      if (left === 'y' && !containsY(rightTokens)) {
        kind = 'explicit';
        evaluationSource = right;
        relationTokens = rightTokens;
        inequality = op;
      } else if (right === 'y' && !containsY(leftTokens)) {
        kind = 'explicit';
        evaluationSource = left;
        relationTokens = leftTokens;
        inequality = FLIPPED[op];
      } else {
        kind = 'implicit';
        evaluationSource = `(${left})-(${right})`;
        relationTokens = [...leftTokens, ...rightTokens];
        inequality = op;
      }
    } else {
      const graphSides = normalizeGraphSides(splitOnEquals(tokens));
      normalized = graphSides.normalized;
      relationTokens = graphSides.tokens;
      if (!normalized) return { ok: false, source, message: 'Enter an expression' };
      const equationSides = normalized.split('=');
      kind = equationSides.length === 2 ? 'implicit' : 'explicit';
      const left = equationSides[0]!;
      const right = equationSides[1];
      if (
        kind === 'implicit' &&
        /^[A-Za-z][A-Za-z0-9_]*$/.test(left) &&
        left !== 'x' &&
        left !== 'y'
      ) {
        throw new Error('Assignments are not allowed; use a relation in x and y');
      }
      evaluationSource = kind === 'implicit' ? `(${left})-(${right!})` : normalized;
    }

    const variables = new Set<string>();
    const relation = compileRelation(
      evaluationSource,
      relationTokens,
      kind === 'implicit',
      definitions,
      variables,
    );
    const conditions = restrictions.flatMap((text) =>
      compileRestriction(text, definitions, variables),
    );
    const createEvaluator = (parameters: Record<string, GraphParameter>) => {
      const f = relation(parameters);
      const checks = conditions.map(({ evaluate, op }) => ({
        test: evaluate(parameters),
        op,
      }));
      if (kind === 'implicit') {
        if (checks.length === 0) {
          return (x: number, y?: number) =>
            y === undefined ? Number.NaN : f(x, y);
        }
        return (x: number, y?: number) => {
          if (y === undefined) return Number.NaN;
          for (const check of checks) {
            if (!satisfies(check.test(x, y), check.op)) return Number.NaN;
          }
          return f(x, y);
        };
      }
      if (checks.length === 0) return (x: number) => f(x, 0);
      // An explicit curve's restriction may read y: the curve's own value.
      return (x: number) => {
        const y = f(x, 0);
        for (const check of checks) {
          if (!satisfies(check.test(x, y), check.op)) return Number.NaN;
        }
        return y;
      };
    };
    return {
      ok: true,
      source,
      normalized,
      kind,
      ...(inequality ? { inequality } : {}),
      variables: [...variables].sort((a, b) => a.localeCompare(b)),
      evaluate: (x, parameters, y) => createEvaluator(parameters)(x, y),
      createEvaluator,
    };
  } catch (error) {
    return {
      ok: false,
      source,
      message:
        error instanceof Error ? friendlyMessage(error.message) : 'Invalid expression',
    };
  }
}
