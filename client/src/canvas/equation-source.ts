/**
 * Source-text handling for the equation editor: turning MathJax's failures into
 * something a whiteboard user can act on, and cleaning up LaTeX that arrives
 * from somewhere else.
 *
 * Kept apart from the panel so it stays plain, testable functions — the panel
 * itself pulls in MathLive, which needs a DOM.
 */

const UNKNOWN_COMMAND = /undefined control sequence:?\s*(\\[a-zA-Z@]+)/i;
const UNBALANCED_BRACES = /(missing|extra).*(brace|\{|\})/i;
const UNBALANCED_DELIMITERS = /missing.*\\(right|left)|extra.*\\(right|left)/i;
/**
 * A failure of the JavaScript engine rather than of the TeX the user typed —
 * deep enough nesting overflows the converter's recursion before MathJax has an
 * opinion about the source. The raw text ("Maximum call stack size exceeded")
 * describes our renderer, not their equation, so it says nothing actionable.
 */
const TOO_COMPLEX =
  /maximum call stack|too much recursion|stack overflow|out of memory/i;

/** A range of the source, as an offset and a length in characters. */
export interface SourceSpan {
  index: number;
  length: number;
}

/**
 * MathJax's messages are written for TeX authors. Rewrite the few that a
 * whiteboard user actually hits; pass anything else through.
 */
export function readableError(message: string): string {
  if (TOO_COMPLEX.test(message)) {
    return 'This expression is nested too deeply to render — try splitting it into separate equations.';
  }
  const unknown = UNKNOWN_COMMAND.exec(message);
  if (unknown) return `Unknown command ${unknown[1]} — check the spelling.`;
  if (UNBALANCED_BRACES.test(message)) {
    return 'Unbalanced braces — every { needs a matching }.';
  }
  if (UNBALANCED_DELIMITERS.test(message)) {
    return 'Unbalanced \\left and \\right.';
  }
  return message;
}

/** First occurrence of a whole command token, so `\fra` doesn't match `\frac`. */
function findCommand(latex: string, command: string): number {
  const name = command.slice(1);
  // Names come from MathJax's own message, but building a RegExp from a string
  // that failed this check would change what gets searched for.
  if (!/^[a-zA-Z@]+$/.test(name)) return -1;
  return latex.search(new RegExp(String.raw`\\${name}(?![a-zA-Z])`));
}

/**
 * The brace that breaks the nesting: an unmatched `}`, or failing that the
 * innermost `{` that is never closed — the point past which everything the user
 * typed is inside a group they didn't mean to still be in.
 */
function findUnbalancedBrace(latex: string): SourceSpan | null {
  const open: number[] = [];
  for (let i = 0; i < latex.length; i += 1) {
    const char = latex[i];
    // A backslash escapes whatever follows, so `\{` and `\}` are literal glyphs
    // rather than grouping. Skipping one character is also enough for a command
    // name, whose remaining letters can't be braces.
    if (char === '\\') {
      i += 1;
      continue;
    }
    if (char === '{') {
      open.push(i);
    } else if (char === '}') {
      if (open.length === 0) return { index: i, length: 1 };
      open.pop();
    }
  }
  const unclosed = open.pop();
  return unclosed === undefined ? null : { index: unclosed, length: 1 };
}

/**
 * Where in `latex` the failure described by `message` is, when that can be
 * worked out from the source alone. MathJax reports what went wrong but not
 * where, so anything it doesn't name stays unlocated.
 */
export function locateLatexError(
  latex: string,
  message: string,
): SourceSpan | null {
  const unknown = UNKNOWN_COMMAND.exec(message);
  if (unknown?.[1]) {
    const index = findCommand(latex, unknown[1]);
    return index === -1 ? null : { index, length: unknown[1].length };
  }
  if (UNBALANCED_BRACES.test(message)) return findUnbalancedBrace(latex);
  return null;
}

/** 1-based line and column of `index`, for pointing at a spot in the source. */
export function sourcePosition(
  latex: string,
  index: number,
): { line: number; column: number } {
  const before = latex.slice(0, index);
  const lastBreak = before.lastIndexOf('\n');
  return { line: before.split('\n').length, column: index - lastBreak };
}

// Longest first: `$$x$$` must not be read as `$` wrapping `$x$`.
const MATH_DELIMITERS = [
  { open: '$$', close: '$$' },
  { open: '\\[', close: '\\]' },
  { open: '\\(', close: '\\)' },
  { open: '$', close: '$' },
] as const;

/**
 * Strip the math delimiters wrapping `text`, or return it unchanged.
 *
 * LaTeX copied out of a textbook, Overleaf or a chat answer arrives wrapped in
 * `$$…$$` or `\[…\]`. The panel's field holds the body of a display equation,
 * where those delimiters are a syntax error rather than markup — so pasting
 * verbatim produces a broken equation for a reason nothing on screen explains.
 *
 * Text with no wrapper comes back untouched, including its whitespace, so a
 * paste into the middle of an expression is left exactly as the user copied it.
 */
export function normalizePastedLatex(text: string): string {
  const trimmed = text.trim();
  for (const { open, close } of MATH_DELIMITERS) {
    if (trimmed.length <= open.length + close.length) continue;
    if (!trimmed.startsWith(open) || !trimmed.endsWith(close)) continue;
    const inner = trimmed.slice(open.length, trimmed.length - close.length);
    // Two wrapped expressions in a row ("$a$ + $b$") open and close the same
    // way as one, and unwrapping them would splice the pair together.
    if (inner.includes(close)) continue;
    return inner.trim();
  }
  return text;
}
