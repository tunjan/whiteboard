import { parse, type MathNode } from 'mathjs';
import type { PlotCurve, PlotProps } from '@whiteboard/shared';

const ALLOWED_SYMBOLS = new Set([
  'x',
  'E',
  'e',
  'pi',
  'PI',
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'sinh',
  'cosh',
  'tanh',
  'sqrt',
  'cbrt',
  'log',
  'log10',
  'ln',
  'exp',
  'abs',
  'min',
  'max',
  'floor',
  'ceil',
  'round',
  'sign',
  'pow',
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

const CURVE_COLORS = ['#2f6df6', '#e5484d', '#1ea672', '#8b5cf6', '#f5a524'];

export interface ValidationResult {
  ok: boolean;
  message?: string;
}

function symbolName(node: MathNode): string | undefined {
  const maybeSymbol = node as MathNode & { name?: unknown };
  return typeof maybeSymbol.name === 'string' ? maybeSymbol.name : undefined;
}

export function validatePlotExpression(expression: string): ValidationResult {
  const trimmed = expression.trim();
  if (!trimmed) return { ok: false, message: 'Empty expression' };

  try {
    const root = parse(trimmed);
    root.traverse((node) => {
      if (FORBIDDEN_NODE_TYPES.has(node.type)) {
        throw new Error(`${node.type.replace('Node', '').toLowerCase()} is not allowed`);
      }
      if (node.type === 'SymbolNode') {
        const name = symbolName(node);
        if (!name || !ALLOWED_SYMBOLS.has(name)) {
          throw new Error(`Unknown symbol "${name ?? '?'}"`);
        }
      }
    });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid expression';
    return { ok: false, message };
  }
}

export function expressionForFunctionPlot(expression: string): string {
  return expression
    .replace(/\bln\s*\(/g, 'log(')
    .replace(/\bpi\b/g, 'PI')
    .replace(/\be\b/g, 'E');
}

export function validatePlotProps(props: PlotProps): ValidationResult {
  if (
    !Number.isFinite(props.w) ||
    !Number.isFinite(props.h) ||
    props.w <= 0 ||
    props.h <= 0
  ) {
    return { ok: false, message: 'Invalid plot size' };
  }
  if (
    !Number.isFinite(props.xMin) ||
    !Number.isFinite(props.xMax) ||
    !Number.isFinite(props.yMin) ||
    !Number.isFinite(props.yMax) ||
    props.xMin >= props.xMax ||
    props.yMin >= props.yMax
  ) {
    return { ok: false, message: 'Invalid domain or range' };
  }
  const enabled = props.curves.filter((curve) => curve.enabled);
  if (!enabled.length) return { ok: false, message: 'No enabled curves' };
  let hasValid = false;
  let firstInvalidMessage = '';
  for (const curve of enabled) {
    const result = validatePlotExpression(curve.expression);
    if (result.ok) {
      hasValid = true;
    } else if (!firstInvalidMessage) {
      firstInvalidMessage = `${curve.expression}: ${result.message ?? 'Invalid expression'}`;
    }
  }
  if (!hasValid) {
    return {
      ok: false,
      message: firstInvalidMessage || 'All enabled curves are invalid',
    };
  }
  return { ok: true };
}

export function curvesToText(curves: PlotCurve[]): string {
  return curves.map((curve) => curve.expression).join('\n');
}

export function curvesFromText(text: string, previous: PlotCurve[]): PlotCurve[] {
  return text
    .split(/\r?\n|,/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6)
    .map((expression, index) => {
      const prior = previous[index];
      return {
        id: prior?.id ?? `curve-${crypto.randomUUID()}`,
        expression,
        color: prior?.color ?? CURVE_COLORS[index % CURVE_COLORS.length]!,
        enabled: prior?.enabled ?? true,
      };
    });
}
