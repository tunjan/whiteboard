import type { GraphExpression, GraphParameter } from '@whiteboard/shared';
import { DEFAULT_GRAPH_PARAMETER } from './graph-defaults';
import {
  createGraphFunctionDefinitions,
  parseGraph3dExpression,
  parseGraphExpression,
} from './graph-parser';

/** The parser a graph's rows are read with: a 3D graph has no `z` slider. */
function parserFor(threeD: boolean) {
  return threeD ? parseGraph3dExpression : parseGraphExpression;
}

export function collectGraphVariables(
  expressions: GraphExpression[],
  threeD = false,
): string[] {
  const definitions = createGraphFunctionDefinitions(expressions);
  const parse = parserFor(threeD);
  const variables = new Set<string>();
  for (const expression of expressions) {
    const parsed = parse(expression.expression, definitions);
    if (!parsed.ok) continue;
    for (const variable of parsed.variables) variables.add(variable);
  }
  return [...variables].sort((a, b) => a.localeCompare(b));
}

export function reconcileGraphParameters(
  expressions: GraphExpression[],
  previous: Record<string, GraphParameter>,
  threeD = false,
): Record<string, GraphParameter> {
  const definitions = createGraphFunctionDefinitions(expressions);
  const parse = parserFor(threeD);
  // A draft may temporarily lose all its variables (including when cleared).
  // Retain settings until every row can be parsed; hidden rows still own theirs.
  const hasDraft = expressions.some(
    (expression) => !parse(expression.expression, definitions).ok,
  );
  const next: Record<string, GraphParameter> = hasDraft ? { ...previous } : {};
  for (const variable of collectGraphVariables(expressions, threeD)) {
    next[variable] = previous[variable] ?? { ...DEFAULT_GRAPH_PARAMETER };
  }
  return next;
}

/**
 * Whether two reconciled parameter sets are the same.
 *
 * {@link reconcileGraphParameters} carries surviving parameters over by
 * reference, so identity per key is enough. Typing in an expression reconciles
 * on every keystroke and almost always lands back on the same set — checking
 * lets the caller leave `parameters` out of the patch entirely rather than
 * writing an identical copy into the document each time.
 */
export function graphParametersEqual(
  a: Record<string, GraphParameter>,
  b: Record<string, GraphParameter>,
): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => a[key] === b[key]);
}

/** Overlay live slider values onto a graph's stored parameters. */
export function mergeGraphParameters(
  parameters: Record<string, GraphParameter>,
  overrides: Record<string, number>,
): Record<string, GraphParameter> {
  const merged: Record<string, GraphParameter> = { ...parameters };
  for (const [name, value] of Object.entries(overrides)) {
    const parameter = merged[name];
    if (parameter) merged[name] = { ...parameter, value };
  }
  return merged;
}
