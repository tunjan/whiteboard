import { parse, type MathNode } from 'mathjs';
import type {
  GraphExpression,
  GraphParameter,
  GraphProps,
  GraphViewport,
} from '@whiteboard/shared';

const FUNCTION_ALIASES = new Map([
  ['sin', 'sin'],
  ['cos', 'cos'],
  ['tan', 'tan'],
  ['sqrt', 'sqrt'],
  ['abs', 'abs'],
  ['log', 'log'],
  ['ln', 'log'],
  ['exp', 'exp'],
  ['min', 'min'],
  ['max', 'max'],
  ['floor', 'floor'],
  ['ceil', 'ceil'],
  ['round', 'round'],
]);

const FUNCTION_ARITY = new Map<string, { min: number; max: number }>([
  ['sin', { min: 1, max: 1 }],
  ['cos', { min: 1, max: 1 }],
  ['tan', { min: 1, max: 1 }],
  ['sqrt', { min: 1, max: 1 }],
  ['abs', { min: 1, max: 1 }],
  ['log', { min: 1, max: 2 }],
  ['exp', { min: 1, max: 1 }],
  ['min', { min: 1, max: Number.POSITIVE_INFINITY }],
  ['max', { min: 1, max: Number.POSITIVE_INFINITY }],
  ['floor', { min: 1, max: 1 }],
  ['ceil', { min: 1, max: 1 }],
  ['round', { min: 1, max: 1 }],
]);

const CONSTANTS = new Set(['e', 'pi']);
const RESERVED_SYMBOLS = new Set([
  'x',
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
  '#7382c6',
  '#c2593f',
  '#4f8a8b',
  '#c2913f',
  '#829c87',
  '#3f3f46',
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
  variables: string[];
  evaluate: (x: number, parameters: Record<string, GraphParameter>) => number;
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

function stripOutputPrefix(source: string): string {
  return source.replace(/^\s*y\s*=/i, '').trim();
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

      if (functionName && nextNonSpace === '(') {
        tokens.push({ type: 'function', value: functionName });
      } else if (CONSTANTS.has(name)) {
        tokens.push({ type: 'constant', value: name });
      } else if (name.includes('x') && /^[A-Za-z]+$/.test(rawName)) {
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

export function normalizeGraphExpression(source: string): string {
  const expression = stripOutputPrefix(source);
  const tokens = tokenize(expression);
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
    const root = parse(normalized);
    const variables = new Set<string>();
    root.traverse((node, _path, parent) => {
      validateStructureNode(node);
      if (node.type !== 'SymbolNode') return;
      const name = symbolName(node);
      if (!name) throw new Error('Invalid symbol');
      if (name === 'x' || CONSTANTS.has(name)) return;
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
      variables: [...variables].sort((a, b) => a.localeCompare(b)),
      evaluate: (x, parameters) => {
        const scope: Record<string, number> = { x };
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
): GraphSampleResult {
  if (!expression.visible) return { ok: true, segments: [] };
  const parsed = parseGraphExpression(expression.expression);
  if (!parsed.ok) {
    return { ok: false, message: parsed.message, segments: [] };
  }

  const count = Math.max(24, Math.min(1600, Math.round(samples)));
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
