/**
 * The typing shortcuts in the equation panel's source field: brackets close
 * themselves, Tab steps to the next empty slot or matrix cell, and Enter knows
 * it is inside an `aligned`.
 *
 * The space key is deliberately not one of them. It used to expand `a/b` into a
 * fraction, brace `x^12`, and turn two-letter shorthands into commands; a key
 * that is also an ordinary character rewrote the source under the caret too
 * often when nobody asked, and its guesses mangled `f(x)/2` and `\text{le}`.
 *
 * Every function here is a pure edit on (source, caret): the panel owns the
 * textarea and the undo history, this file owns the rules.
 */

/** A replacement for the whole source, and where the caret lands in it. */
export interface SourceEdit {
  value: string;
  caret: number;
}

/** A range of the old source, and the text that takes its place. */
export interface SourceReplacement {
  start: number;
  end: number;
  text: string;
}

/**
 * The smallest single replacement that turns `previous` into `next`, or `null`
 * when they already match.
 *
 * The rules above rewrite the whole source because that is the simplest thing
 * to express and to test. The field, though, has to receive the change as the
 * *edit* it is: a whole-value assignment throws away the browser's undo history
 * for the field, so a rewrite made with one keypress could only be undone
 * by losing everything typed before it (see `applyEdit` in the panel).
 *
 * One replacement is enough because every rule here changes one contiguous
 * stretch of the source — trimming the shared prefix and suffix recovers it.
 */
export function editReplacement(
  previous: string,
  next: string,
): SourceReplacement | null {
  if (previous === next) return null;
  let start = 0;
  while (
    start < previous.length &&
    start < next.length &&
    previous[start] === next[start]
  ) {
    start += 1;
  }
  let end = previous.length;
  let nextEnd = next.length;
  while (
    end > start &&
    nextEnd > start &&
    previous[end - 1] === next[nextEnd - 1]
  ) {
    end -= 1;
    nextEnd -= 1;
  }
  return { start, end, text: next.slice(start, nextEnd) };
}

const OPENERS: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
const CLOSERS = new Set([')', ']', '}']);

/** What may follow a bracket that closes itself: nothing waiting to be typed. */
const CLOSE_BEFORE = /^[\s)\]},;&=+\-*/]/;

/** Environments where `\\` starts a row and `&` separates columns. */
const ROW_ENVIRONMENTS =
  /^(aligned|align\*?|alignat\*?|gather\*?|split|cases|array|[pbBvV]?matrix)$/;

/** Environments laid out in columns, where Tab means "next cell". */
const COLUMN_ENVIRONMENTS = /^(aligned|align\*?|cases|array|[pbBvV]?matrix)$/;

function splice(
  value: string,
  from: number,
  to: number,
  text: string,
  caret: number,
): SourceEdit {
  return {
    value: value.slice(0, from) + text + value.slice(to),
    caret: from + caret,
  };
}

/**
 * Typing an opening bracket: wrap the selection, or close the bracket and sit
 * between the pair.
 *
 * Only closes when nothing is waiting to the right, so adding a bracket to the
 * front of an expression already written doesn't strand a `)` in the middle
 * of it.
 */
export function openBracket(
  value: string,
  start: number,
  end: number,
  char: string,
): SourceEdit | null {
  const closer = OPENERS[char];
  if (!closer) return null;
  if (start !== end) {
    const inner = value.slice(start, end);
    return splice(
      value,
      start,
      end,
      `${char}${inner}${closer}`,
      inner.length + 2,
    );
  }
  const rest = value.slice(start);
  if (rest && !CLOSE_BEFORE.test(rest)) return null;
  return splice(value, start, start, char + closer, 1);
}

/** Typing the closing bracket that is already there: step over it instead. */
export function skipClosingBracket(
  value: string,
  start: number,
  end: number,
  char: string,
): SourceEdit | null {
  if (start !== end || !CLOSERS.has(char) || value[start] !== char) return null;
  return { value, caret: start + 1 };
}

/** The innermost `\begin{…}` the caret is inside, or `null` at the top level. */
export function enclosingEnvironment(
  value: string,
  caret: number,
): string | null {
  const stack: string[] = [];
  const pattern = /\\(begin|end)\{([^}]*)\}/g;
  const before = value.slice(0, caret);
  let match = pattern.exec(before);
  while (match) {
    if (match[1] === 'begin') stack.push(match[2] as string);
    else stack.pop();
    match = pattern.exec(before);
  }
  return stack.at(-1) ?? null;
}

/** Enter inside `aligned` or `cases` ends the row with `\\` before wrapping. */
export function environmentNewline(
  value: string,
  caret: number,
): SourceEdit | null {
  const environment = enclosingEnvironment(value, caret);
  if (!environment || !ROW_ENVIRONMENTS.test(environment)) return null;
  const line = value.slice(0, caret).split('\n').at(-1) ?? '';
  if (!line.trim() || line.trimEnd().endsWith('\\\\')) return null;
  return splice(value, caret, caret, ' \\\\\n  ', 6);
}

/**
 * What Tab does inside the field: fill the next empty group, or move to the
 * next cell of a matrix. Anything else returns `null` and Tab leaves the field,
 * which is the only way out for a keyboard user.
 */
export function tabEdit(value: string, caret: number): SourceEdit | null {
  const slot = value.indexOf('{}', caret);
  if (slot !== -1) return { value, caret: slot + 1 };
  const environment = enclosingEnvironment(value, caret);
  if (environment && COLUMN_ENVIRONMENTS.test(environment)) {
    return splice(value, caret, caret, ' & ', 3);
  }
  return null;
}
