// Number-only build: it carries the same parser and the same real-valued
// functions, without the BigNumber/Complex/Fraction/matrix types this file has
// no use for. The one behavioural difference is that complex results
// (`sqrt(-1)`, `log(-1)`) arrive as NaN rather than a Complex — which is what
// `evaluate` below already coerced them to, so plots are unchanged.
import { parse, type MathNode } from 'mathjs/number';
import type { GraphExpression, GraphParameter } from '@whiteboard/shared';
import { DEFAULT_GRAPH_PARAMETER, PARAMETRIC_VARIABLE } from './graph-defaults';

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

const BUILTIN_FUNCTION_NAMES = new Set([
  ...FUNCTION_ALIASES.keys(),
  ...FUNCTION_ALIASES.values(),
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

export interface ParsedGraphFunction {
  ok: true;
  source: string;
  normalized: string;
  kind: 'explicit' | 'implicit';
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
  error?: string;
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

function tokenize(
  source: string,
  userFunctions: ReadonlySet<string> = new Set(),
): Token[] {
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

function normalizeTokens(tokens: Token[]): string {
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

function normalizeGraphExpressionSide(
  source: string,
  userFunctions: ReadonlySet<string> = new Set(),
): string {
  return normalizeTokens(tokenize(source.trim(), userFunctions));
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

function containsY(
  source: string,
  userFunctions: ReadonlySet<string>,
): boolean {
  return tokenize(source, userFunctions).some(
    (token) => token.type === 'identifier' && token.value === 'y',
  );
}

export function normalizeGraphExpression(
  source: string,
  definitions: GraphFunctionDefinitions = EMPTY_GRAPH_FUNCTIONS,
): string {
  const userFunctions = new Set(definitions.keys());
  const sides = source.split('=');
  if (sides.length > 2) throw new Error('Use a single equals sign');
  if (sides.length === 1) {
    return normalizeGraphExpressionSide(sides[0]!, userFunctions);
  }

  const left = normalizeGraphExpressionSide(sides[0]!, userFunctions);
  const right = normalizeGraphExpressionSide(sides[1]!, userFunctions);
  if (!left || !right) throw new Error('Enter both sides of the equation');

  // Keep ordinary functions on the cheaper, higher-resolution 1D sampler.
  if (left === 'y' && !containsY(right, userFunctions)) return right;
  if (right === 'y' && !containsY(left, userFunctions)) return left;
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
  if (!match) return null;
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

  const normalizedBody = normalizeGraphExpressionSide(
    source.body,
    userFunctions,
  );
  if (!normalizedBody) throw new Error('Enter a function body');
  const root = parse(normalizedBody);
  const directVariables = new Set<string>();
  const dependencies = new Set<string>();

  root.traverse((node, _path, parent) => {
    validateStructureNode(node, userFunctions);
    const calledFunction = functionNodeName(node);
    if (calledFunction && userFunctions.has(calledFunction)) {
      dependencies.add(calledFunction);
    }
    if (node.type !== 'SymbolNode') return;
    const name = symbolName(node);
    if (!name) throw new Error('Invalid symbol');
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
  });

  const compiled = root.compile();
  return {
    name: source.name,
    argument: source.argument,
    normalizedBody,
    directVariables: [...directVariables].sort((a, b) => a.localeCompare(b)),
    dependencies: [...dependencies].sort((a, b) => a.localeCompare(b)),
    evaluateRaw: (scope) => {
      try {
        const value = compiled.evaluate(scope);
        return typeof value === 'number' ? value : Number.NaN;
      } catch {
        return Number.NaN;
      }
    },
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

  const userFunctions = new Set(sources.keys());
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
  if (definition.error || !definition.evaluateRaw) {
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

function evaluateGraphFunction(
  name: string,
  input: unknown,
  parameters: Record<string, GraphParameter>,
  definitions: GraphFunctionDefinitions,
  active: ReadonlySet<string>,
): number {
  if (typeof input !== 'number' || active.has(name)) return Number.NaN;
  const definition = definitions.get(name);
  if (!definition?.evaluateRaw || definition.error) return Number.NaN;
  const nextActive = new Set(active);
  nextActive.add(name);
  const scope = createEvaluationScope(
    { [definition.argument]: input },
    parameters,
    definition.directVariables,
    definitions,
    nextActive,
  );
  return definition.evaluateRaw(scope);
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
  active: ReadonlySet<string> = new Set(),
): EvaluationScope {
  const scope: EvaluationScope = new Map(Object.entries(values));
  for (const variable of variables) {
    scope.set(
      variable,
      parameters[variable]?.value ?? DEFAULT_GRAPH_PARAMETER.value,
    );
  }
  for (const name of definitions.keys()) {
    scope.set(name, (input: unknown) =>
      evaluateGraphFunction(name, input, parameters, definitions, active),
    );
  }
  return scope;
}

type CompiledSide = {
  normalized: string;
  evaluate: (scope: EvaluationScope) => number;
  usesParameter: boolean;
};

function compileCoordinateSide(
  tokens: Token[],
  variables: Set<string>,
  definitions: GraphFunctionDefinitions,
): CompiledSide {
  const normalized = normalizeTokens(tokens);
  const root = parse(normalized);
  let usesParameter = false;
  const userFunctions = new Set(definitions.keys());
  const dependencies = new Set<string>();

  root.traverse((node, _path, parent) => {
    validateStructureNode(node, userFunctions);
    const calledFunction = functionNodeName(node);
    if (calledFunction && userFunctions.has(calledFunction)) {
      dependencies.add(calledFunction);
    }
    if (node.type !== 'SymbolNode') return;
    const name = symbolName(node);
    if (!name) throw new Error('Invalid symbol');
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
  });
  for (const dependency of dependencies) {
    addDefinitionVariables(dependency, definitions, variables);
  }

  const compiled = root.compile();
  return {
    normalized,
    usesParameter,
    evaluate: (scope) => {
      try {
        const value = compiled.evaluate(scope);
        return typeof value === 'number' ? value : Number.NaN;
      } catch {
        return Number.NaN;
      }
    },
  };
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

  // A named definition keeps building its scope per call: the recursion guard
  // (`active`) is part of that scope, so it cannot be hoisted out of the loop
  // the way a plain expression's can.
  const evaluate = (x: number, parameters: Record<string, GraphParameter>) =>
    evaluateGraphFunction(
      definition.name,
      x,
      parameters,
      localDefinitions,
      new Set(),
    );

  return {
    ok: true,
    source,
    normalized: `${definition.name}(${definition.argument})=${definition.normalizedBody}`,
    kind: 'explicit',
    variables: [...variables].sort((a, b) => a.localeCompare(b)),
    evaluate,
    createEvaluator: (parameters) => (x) => evaluate(x, parameters),
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
    const userFunctions = new Set(definitions.keys());
    if (trimmed.startsWith('(')) {
      const coordinate = splitCoordinate(tokenize(trimmed, userFunctions));
      if (coordinate) {
        return parseCoordinateExpression(source, coordinate, definitions);
      }
    }
    const normalized = normalizeGraphExpression(trimmed, definitions);
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
    const dependencies = new Set<string>();
    root.traverse((node, _path, parent) => {
      validateStructureNode(node, userFunctions);
      const calledFunction = functionNodeName(node);
      if (calledFunction && userFunctions.has(calledFunction)) {
        dependencies.add(calledFunction);
      }
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
      if (isFunctionSymbol(name, node, parent, userFunctions)) return;
      if (!isVariableName(name)) {
        throw new Error(`Variable "${name}" is not allowed`);
      }
      variables.add(name);
    });
    for (const dependency of dependencies) {
      addDefinitionVariables(dependency, definitions, variables);
    }
    const compiled = root.compile();
    const createEvaluator = (parameters: Record<string, GraphParameter>) => {
      const scope = createEvaluationScope(
        kind === 'implicit' ? { x: 0, y: 0 } : { x: 0 },
        parameters,
        variables,
        definitions,
      );
      return (x: number, y?: number) => {
        if (kind === 'implicit') {
          if (y === undefined) return Number.NaN;
          scope.set('y', y);
        }
        scope.set('x', x);
        try {
          const value = compiled.evaluate(scope);
          return typeof value === 'number' ? value : Number.NaN;
        } catch {
          return Number.NaN;
        }
      };
    };
    return {
      ok: true,
      source,
      normalized,
      kind,
      variables: [...variables].sort((a, b) => a.localeCompare(b)),
      evaluate: (x, parameters, y) => createEvaluator(parameters)(x, y),
      createEvaluator,
    };
  } catch (error) {
    return {
      ok: false,
      source,
      message: error instanceof Error ? error.message : 'Invalid expression',
    };
  }
}
