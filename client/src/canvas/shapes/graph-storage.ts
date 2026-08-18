import * as Y from 'yjs';
import type {
  GraphExpression,
  GraphParametricDomain,
  StrokeDash,
} from '@whiteboard/shared';

/**
 * Yjs encoding for a graph shape's expression list.
 *
 * A graph is a long-lived object that several people edit at once, one row
 * each. Held inside the shape's `props` blob the whole list was a single value,
 * so two people editing different rows resolved last-write-wins and one of them
 * simply lost their expression — and every keystroke rewrote every row, every
 * slider and every plotted point into the document, which the CRDT then keeps
 * forever.
 *
 * Stored as a Y.Array of Y.Maps, a row is an independent object and a field
 * within it an independent value: concurrent edits to different rows (or to the
 * color and the formula of one row) both survive, and a keystroke writes one
 * string. The expression text itself is still a scalar, so two people typing
 * into the *same* row in the same instant is the one case that still resolves
 * last-write-wins — the same granularity a text shape had before Y.Text.
 */

/** Every field of a stored expression, in write order. */
const EXPRESSION_KEYS = [
  'id',
  'expression',
  'color',
  'visible',
  'dash',
  'width',
  'domain',
] as const satisfies readonly (keyof GraphExpression)[];

export type YGraphExpression = Y.Map<unknown>;

function isDomain(value: unknown): value is GraphParametricDomain {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as GraphParametricDomain).min === 'number' &&
    typeof (value as GraphParametricDomain).max === 'number'
  );
}

/** Domains are stored as a plain object, so identity comparison won't do. */
function fieldsEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (isDomain(a) && isDomain(b)) return a.min === b.min && a.max === b.max;
  return false;
}

function entryToExpression(entry: YGraphExpression): GraphExpression {
  const width = entry.get('width');
  const domain = entry.get('domain');
  const dash = entry.get('dash');
  const expression: GraphExpression = {
    id: typeof entry.get('id') === 'string' ? (entry.get('id') as string) : '',
    expression:
      typeof entry.get('expression') === 'string'
        ? (entry.get('expression') as string)
        : '',
    color:
      typeof entry.get('color') === 'string'
        ? (entry.get('color') as string)
        : '#000000',
    visible: entry.get('visible') !== false,
    dash: typeof dash === 'string' ? (dash as StrokeDash) : 'solid',
  };
  if (typeof width === 'number') expression.width = width;
  if (isDomain(domain)) expression.domain = { min: domain.min, max: domain.max };
  return expression;
}

/** Write the fields of `expression` into `entry`, touching only what changed. */
function writeExpressionFields(
  entry: YGraphExpression,
  expression: GraphExpression,
): void {
  for (const key of EXPRESSION_KEYS) {
    const value = expression[key];
    if (value === undefined) {
      if (entry.has(key)) entry.delete(key);
    } else if (!fieldsEqual(entry.get(key), value)) {
      entry.set(key, value);
    }
  }
}

export function expressionToY(expression: GraphExpression): YGraphExpression {
  const entry = new Y.Map<unknown>();
  writeExpressionFields(entry, expression);
  return entry;
}

/**
 * Materialize a graph's expressions, accepting either storage form.
 *
 * Boards written before the promotion keep their list inside `props`; those are
 * read in place and only converted when edited, matching how draw strokes and
 * text shapes handle their own older forms.
 */
export function readGraphExpressions(
  m: Y.Map<unknown>,
  storedProps: Record<string, unknown>,
): GraphExpression[] {
  const arr = m.get('expressions');
  if (arr instanceof Y.Array) {
    return (arr as Y.Array<YGraphExpression>).map(entryToExpression);
  }
  return Array.isArray(storedProps.expressions)
    ? (storedProps.expressions as GraphExpression[])
    : [];
}

function indexOfId(
  arr: Y.Array<YGraphExpression>,
  id: string,
  from: number,
): number {
  for (let i = from; i < arr.length; i += 1) {
    if (arr.get(i)?.get('id') === id) return i;
  }
  return -1;
}

/**
 * Write `next` into an expressions Y.Array, reconciling by row id.
 *
 * The common edits — typing in a row, recoloring, toggling visibility — leave
 * the ids and their order alone and take the patch-in-place path, so they cost
 * one field write. Adding, deleting and reordering rows are rare and operate on
 * a list of at most a few dozen entries, so the position fix-up below being
 * quadratic in the worst case doesn't matter.
 */
export function syncYGraphExpressions(
  arr: Y.Array<YGraphExpression>,
  next: readonly GraphExpression[],
): void {
  const nextIds = new Set(next.map((expression) => expression.id));
  for (let i = arr.length - 1; i >= 0; i -= 1) {
    const id = arr.get(i)?.get('id');
    if (typeof id !== 'string' || !nextIds.has(id)) arr.delete(i, 1);
  }

  for (let i = 0; i < next.length; i += 1) {
    const expression = next[i]!;
    if (arr.get(i)?.get('id') !== expression.id) {
      const existing = indexOfId(arr, expression.id, i);
      if (existing === -1) {
        arr.insert(i, [expressionToY(expression)]);
        continue;
      }
      // A moved row: Yjs has no move, so re-create it at its new position.
      const moved = entryToExpression(arr.get(existing)!);
      arr.delete(existing, 1);
      arr.insert(i, [expressionToY(moved)]);
    }
    writeExpressionFields(arr.get(i)!, expression);
  }
}

/**
 * The Y.Array holding a graph's expressions, converting a legacy props-array
 * graph on first write.
 */
export function ensureGraphExpressionsArray(
  m: Y.Map<unknown>,
): Y.Array<YGraphExpression> {
  const existing = m.get('expressions');
  if (existing instanceof Y.Array) {
    return existing as Y.Array<YGraphExpression>;
  }
  const legacy = m.get('props') as { expressions?: unknown } | undefined;
  const arr = Y.Array.from(
    (Array.isArray(legacy?.expressions)
      ? (legacy.expressions as GraphExpression[])
      : []
    ).map(expressionToY),
  );
  m.set('expressions', arr);
  return arr;
}

/** Encode expressions for a brand-new graph shape's Y.Array. */
export function encodeGraphExpressionsForStorage(
  expressions: readonly GraphExpression[],
): YGraphExpression[] {
  return expressions.map(expressionToY);
}
