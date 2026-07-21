import { parse, type MathNode } from 'mathjs';
import type {
  GraphExpression,
  GraphParameter,
  GraphPoint,
  GraphProps,
  GraphViewport,
} from '@whiteboard/shared';

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
]);

const CONSTANTS = new Set(['e', 'pi']);
const RESERVED_SYMBOLS = new Set([
  'x',
  'y',
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

export const GRAPH_COLORS = [
  '#274001',
  '#828a00',
  '#f29f05',
  '#f25c05',
  '#d6568c',
  '#4d8584',
  '#a62f03',
  '#400d01',
];

export const DEFAULT_GRAPH_VIEWPORT: GraphViewport = {
  xMin: -10,
  xMax: 10,
  yMin: -6,
  yMax: 6,
};

export const DEFAULT_GRAPH_PARAMETER: GraphParameter = {
  value: 1,
  min: -10,
  max: 10,
  step: 0.1,
};

export const DEFAULT_GRAPH_PROPS: GraphProps = {
  w: 420,
  h: 280,
  viewport: DEFAULT_GRAPH_VIEWPORT,
  expressions: [
    {
      id: 'expr-default',
      expression: 'y = sin(x)',
      color: GRAPH_COLORS[0]!,
      visible: true,
      dash: 'solid',
    },
  ],
  parameters: {},
  showAxisLabels: true,
  points: [],
  showIntersections: false,
};

type TokenType =
  | 'number'
  | 'identifier'
  | 'constant'
  | 'function'
  | 'operator'
  | 'lparen'
  | 'rparen'
  | 'comma';

interface Token {
  type: TokenType;
  value: string;
}

export interface ParsedGraphExpression {
  ok: true;
  source: string;
  normalized: string;
  kind: 'explicit' | 'implicit';
  variables: string[];
  evaluate: (
    x: number,
    parameters: Record<string, GraphParameter>,
    y?: number,
  ) => number;
}

export interface GraphExpressionError {
  ok: false;
  source: string;
  message: string;
}

export type GraphExpressionParseResult =
  | ParsedGraphExpression
  | GraphExpressionError;

export interface GraphSampleResult {
  ok: boolean;
  message?: string;
  segments: { x: number; y: number }[][];
}

function cloneViewport(viewport: GraphViewport): GraphViewport {
  return { ...viewport };
}

export function createDefaultGraphProps(): GraphProps {
  return {
    ...DEFAULT_GRAPH_PROPS,
    viewport: cloneViewport(DEFAULT_GRAPH_VIEWPORT),
    expressions: DEFAULT_GRAPH_PROPS.expressions.map((expression) => ({
      ...expression,
    })),
    parameters: {},
    points: [],
  };
}

export function createGraphExpression(index: number): GraphExpression {
  return {
    id:
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? `expr-${crypto.randomUUID()}`
        : `expr-${Date.now()}-${index}`,
    expression: '',
    color: GRAPH_COLORS[index % GRAPH_COLORS.length]!,
    visible: true,
    dash: 'solid',
  };
}

export function createGraphPoint(index: number): GraphPoint {
  return {
    id:
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? `pt-${crypto.randomUUID()}`
        : `pt-${Date.now()}-${index}`,
    x: 0,
    y: 0,
    color: GRAPH_COLORS[index % GRAPH_COLORS.length]!,
    visible: true,
  };
}

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
    token?.type === 'rparen'
  );
}

function canStartFactor(token: Token): boolean {
  return (
    token.type === 'number' ||
    token.type === 'identifier' ||
    token.type === 'constant' ||
    token.type === 'function' ||
    token.type === 'lparen'
  );
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

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

    if (isNameStart(char)) {
      let end = i + 1;
      while (end < source.length && isNamePart(source[end]!)) end += 1;
      const rawName = source.slice(i, end);
      const name = rawName.toLowerCase();
      const nextNonSpace = source.slice(end).match(/\S/)?.[0] ?? '';
      const functionName = FUNCTION_ALIASES.get(name);

      if (functionName) {
        tokens.push({
          type: nextNonSpace === '(' ? 'function' : 'identifier',
          value: functionName,
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

    if (char === '(') tokens.push({ type: 'lparen', value: char });
    else if (char === ')') tokens.push({ type: 'rparen', value: char });
    else if (char === ',') tokens.push({ type: 'comma', value: char });
    else if ('+-*/^%'.includes(char)) {
      tokens.push({ type: 'operator', value: char });
    } else {
      throw new Error(`Unexpected token "${char}"`);
    }
    i += 1;
  }

  return tokens;
}

function normalizeGraphExpressionSide(source: string): string {
  const tokens = tokenize(source.trim());
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
    normalized += token.value;
    previous = token;
  }

  return normalized;
}

function containsY(source: string): boolean {
  return tokenize(source).some(
    (token) => token.type === 'identifier' && token.value === 'y',
  );
}

export function normalizeGraphExpression(source: string): string {
  const sides = source.split('=');
  if (sides.length > 2) throw new Error('Use a single equals sign');
  if (sides.length === 1) return normalizeGraphExpressionSide(sides[0]!);

  const left = normalizeGraphExpressionSide(sides[0]!);
  const right = normalizeGraphExpressionSide(sides[1]!);
  if (!left || !right) throw new Error('Enter both sides of the equation');

  // Keep ordinary functions on the cheaper, higher-resolution 1D sampler.
  if (left === 'y' && !containsY(right)) return right;
  if (right === 'y' && !containsY(left)) return left;
  return `${left}=${right}`;
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

function validateStructureNode(node: MathNode): void {
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
    const canonicalName = name ? (FUNCTION_ALIASES.get(name) ?? name) : null;
    if (
      !canonicalName ||
      !FUNCTION_ARITY.has(canonicalName)
    ) {
      throw new Error(`Function "${name ?? '?'}" is not allowed`);
    }
    const args = (node as MathNode & { args?: unknown[] }).args;
    const count = Array.isArray(args) ? args.length : 0;
    const arity = FUNCTION_ARITY.get(canonicalName)!;
    if (count < arity.min || count > arity.max) {
      throw new Error(
        `Function "${name}" expects ${
          arity.min === arity.max ? arity.min : `${arity.min}-${arity.max}`
        } argument${arity.max === 1 ? '' : 's'}`,
      );
    }
  }
}

export function parseGraphExpression(source: string): GraphExpressionParseResult {
  const trimmed = source.trim();
  if (!trimmed) return { ok: false, source, message: 'Enter an expression' };

  try {
    const normalized = normalizeGraphExpression(trimmed);
    if (!normalized) return { ok: false, source, message: 'Enter an expression' };
    const equationSides = normalized.split('=');
    const kind = equationSides.length === 2 ? 'implicit' : 'explicit';
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
    const evaluationSource =
      kind === 'implicit' ? `(${left})-(${right!})` : normalized;
    const root = parse(evaluationSource);
    const variables = new Set<string>();
    root.traverse((node, _path, parent) => {
      validateStructureNode(node);
      if (node.type !== 'SymbolNode') return;
      const name = symbolName(node);
      if (!name) throw new Error('Invalid symbol');
      if (
        name === 'x' ||
        (kind === 'implicit' && name === 'y') ||
        CONSTANTS.has(name)
      ) {
        return;
      }
      if (name === 'y') {
        throw new Error('Use y in an equation, for example x^2 + y^2 = 1');
      }
      if (FUNCTION_ALIASES.has(name) || [...FUNCTION_ALIASES.values()].includes(name)) {
        const functionParent = parent as (MathNode & { fn?: MathNode }) | null;
        if (functionParent?.type === 'FunctionNode' && functionParent.fn === node) {
          return;
        }
        throw new Error(`Function "${name}" must be called`);
      }
      if (!isVariableName(name)) {
        throw new Error(`Variable "${name}" is not allowed`);
      }
      variables.add(name);
    });
    const compiled = root.compile();
    return {
      ok: true,
      source,
      normalized,
      kind,
      variables: [...variables].sort((a, b) => a.localeCompare(b)),
      evaluate: (x, parameters, y) => {
        if (kind === 'implicit' && y === undefined) return Number.NaN;
        const scope: Record<string, number> =
          kind === 'implicit' ? { x, y: y! } : { x };
        for (const name of variables) {
          scope[name] = parameters[name]?.value ?? DEFAULT_GRAPH_PARAMETER.value;
        }
        try {
          const value = compiled.evaluate(scope);
          return typeof value === 'number' ? value : Number.NaN;
        } catch {
          return Number.NaN;
        }
      },
    };
  } catch (error) {
    return {
      ok: false,
      source,
      message: error instanceof Error ? error.message : 'Invalid expression',
    };
  }
}

type ContourPoint = { x: number; y: number };
type ContourLine = { a: ContourPoint; b: ContourPoint };

function interpolateZero(
  a: ContourPoint,
  b: ContourPoint,
  valueA: number,
  valueB: number,
): ContourPoint {
  const denominator = valueA - valueB;
  const t =
    denominator === 0 ? 0.5 : Math.min(1, Math.max(0, valueA / denominator));
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

function stitchContourLines(
  lines: ContourLine[],
  xStep: number,
  yStep: number,
): ContourPoint[][] {
  const xTolerance = Math.max(Math.abs(xStep) * 1e-5, Number.EPSILON);
  const yTolerance = Math.max(Math.abs(yStep) * 1e-5, Number.EPSILON);
  const key = (point: ContourPoint) =>
    `${Math.round(point.x / xTolerance)}:${Math.round(point.y / yTolerance)}`;
  const endpoints = lines.map((line) => ({ a: key(line.a), b: key(line.b) }));
  const adjacency = new Map<string, number[]>();

  endpoints.forEach((endpoint, index) => {
    adjacency.set(endpoint.a, [...(adjacency.get(endpoint.a) ?? []), index]);
    adjacency.set(endpoint.b, [...(adjacency.get(endpoint.b) ?? []), index]);
  });

  const used = new Set<number>();
  const paths: ContourPoint[][] = [];
  for (let seed = 0; seed < lines.length; seed += 1) {
    if (used.has(seed)) continue;
    const seedLine = lines[seed]!;
    const seedEndpoints = endpoints[seed]!;
    const startAtA = (adjacency.get(seedEndpoints.a)?.length ?? 0) !== 2;
    const startKey = startAtA ? seedEndpoints.a : seedEndpoints.b;
    const points = [startAtA ? seedLine.a : seedLine.b];
    let currentKey = startKey;

    while (true) {
      const nextIndex = adjacency.get(currentKey)?.find((index) => !used.has(index));
      if (nextIndex === undefined) break;
      used.add(nextIndex);
      const line = lines[nextIndex]!;
      const endpoint = endpoints[nextIndex]!;
      const leavesFromA = endpoint.a === currentKey;
      points.push(leavesFromA ? line.b : line.a);
      currentKey = leavesFromA ? endpoint.b : endpoint.a;
      if (currentKey === startKey) break;
    }

    if (points.length > 1) paths.push(points);
  }
  return paths;
}

function sampleImplicitGraphExpression(
  parsed: ParsedGraphExpression,
  viewport: GraphViewport,
  parameters: Record<string, GraphParameter>,
  horizontalSamples: number,
  verticalSamples: number,
): GraphSampleResult {
  const columns = Math.max(
    32,
    Math.min(320, Math.round(horizontalSamples * 0.55)),
  );
  const rows = Math.max(
    32,
    Math.min(240, Math.round(verticalSamples * 0.55)),
  );
  const xStep = (viewport.xMax - viewport.xMin) / columns;
  const yStep = (viewport.yMax - viewport.yMin) / rows;
  const values: number[][] = Array.from({ length: rows + 1 }, () =>
    Array<number>(columns + 1),
  );

  for (let row = 0; row <= rows; row += 1) {
    const y = viewport.yMin + row * yStep;
    for (let column = 0; column <= columns; column += 1) {
      const x = viewport.xMin + column * xStep;
      values[row]![column] = parsed.evaluate(x, parameters, y);
    }
  }

  const lines: ContourLine[] = [];
  for (let row = 0; row < rows; row += 1) {
    const y0 = viewport.yMin + row * yStep;
    const y1 = y0 + yStep;
    for (let column = 0; column < columns; column += 1) {
      const x0 = viewport.xMin + column * xStep;
      const x1 = x0 + xStep;
      const cellPoints: ContourPoint[] = [
        { x: x0, y: y0 },
        { x: x1, y: y0 },
        { x: x1, y: y1 },
        { x: x0, y: y1 },
      ];
      const cellValues = [
        values[row]![column]!,
        values[row]![column + 1]!,
        values[row + 1]![column + 1]!,
        values[row + 1]![column]!,
      ];
      if (cellValues.some((value) => !Number.isFinite(value))) continue;

      const cellCase = cellValues.reduce(
        (mask, value, index) => mask | (value >= 0 ? 1 << index : 0),
        0,
      );
      if (cellCase === 0 || cellCase === 15) continue;

      const edgePoint = (edge: number): ContourPoint => {
        const edgeCorners = [
          [0, 1],
          [1, 2],
          [2, 3],
          [3, 0],
        ] as const;
        const [a, b] = edgeCorners[edge]!;
        return interpolateZero(
          cellPoints[a]!,
          cellPoints[b]!,
          cellValues[a]!,
          cellValues[b]!,
        );
      };
      const centerPositive =
        (cellValues[0]! +
          cellValues[1]! +
          cellValues[2]! +
          cellValues[3]!) /
          4 >=
        0;
      const edgePairs: [number, number][] = (() => {
        switch (cellCase) {
          case 1:
            return [[3, 0]];
          case 2:
            return [[0, 1]];
          case 3:
            return [[3, 1]];
          case 4:
            return [[1, 2]];
          case 5:
            return centerPositive
              ? [[0, 1], [2, 3]]
              : [[3, 0], [1, 2]];
          case 6:
            return [[0, 2]];
          case 7:
            return [[3, 2]];
          case 8:
            return [[2, 3]];
          case 9:
            return [[0, 2]];
          case 10:
            return centerPositive
              ? [[3, 0], [1, 2]]
              : [[0, 1], [2, 3]];
          case 11:
            return [[1, 2]];
          case 12:
            return [[3, 1]];
          case 13:
            return [[0, 1]];
          case 14:
            return [[3, 0]];
          default:
            return [];
        }
      })();
      for (const [from, to] of edgePairs) {
        lines.push({ a: edgePoint(from), b: edgePoint(to) });
      }
    }
  }

  return { ok: true, segments: stitchContourLines(lines, xStep, yStep) };
}

export function collectGraphVariables(expressions: GraphExpression[]): string[] {
  const variables = new Set<string>();
  for (const expression of expressions) {
    if (!expression.visible) continue;
    const parsed = parseGraphExpression(expression.expression);
    if (!parsed.ok) continue;
    for (const variable of parsed.variables) variables.add(variable);
  }
  return [...variables].sort((a, b) => a.localeCompare(b));
}

export function reconcileGraphParameters(
  expressions: GraphExpression[],
  previous: Record<string, GraphParameter>,
): Record<string, GraphParameter> {
  const next: Record<string, GraphParameter> = {};
  for (const variable of collectGraphVariables(expressions)) {
    next[variable] = previous[variable] ?? { ...DEFAULT_GRAPH_PARAMETER };
  }
  return next;
}

export function sampleGraphExpression(
  expression: GraphExpression,
  viewport: GraphViewport,
  parameters: Record<string, GraphParameter>,
  samples: number,
  verticalSamples = samples,
): GraphSampleResult {
  if (!expression.visible) return { ok: true, segments: [] };
  const parsed = parseGraphExpression(expression.expression);
  if (!parsed.ok) {
    return { ok: false, message: parsed.message, segments: [] };
  }

  const count = Math.max(24, Math.min(1600, Math.round(samples)));
  if (parsed.kind === 'implicit') {
    const verticalCount = Math.max(
      24,
      Math.min(1600, Math.round(verticalSamples)),
    );
    return sampleImplicitGraphExpression(
      parsed,
      viewport,
      parameters,
      count,
      verticalCount,
    );
  }
  const xRange = viewport.xMax - viewport.xMin;
  const yRange = viewport.yMax - viewport.yMin;
  const discontinuityThreshold = Math.abs(yRange) * 1.75;
  const segments: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] = [];
  let previousY: number | null = null;

  for (let i = 0; i <= count; i += 1) {
    const x = viewport.xMin + (xRange * i) / count;
    let y = Number.NaN;
    try {
      y = parsed.evaluate(x, parameters);
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Invalid expression',
        segments: [],
      };
    }
    const finite = Number.isFinite(x) && Number.isFinite(y);
    const jumps =
      finite &&
      previousY !== null &&
      Number.isFinite(previousY) &&
      Math.abs(y - previousY) > discontinuityThreshold;

    if (!finite || jumps) {
      if (current.length > 1) segments.push(current);
      current = [];
      previousY = finite ? y : null;
      continue;
    }

    current.push({ x, y });
    previousY = y;
  }

  if (current.length > 1) segments.push(current);
  return { ok: true, segments };
}
