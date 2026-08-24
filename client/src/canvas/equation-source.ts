/**
 * Source-text handling for the equation editor: turning MathJax's failures into
 * something a whiteboard user can act on, and cleaning up LaTeX that arrives
 * from somewhere else.
 *
 * Kept apart from the panel so it stays plain, testable functions — the panel
 * itself pulls in MathLive, which needs a DOM.
 */
import type { SourceEdit } from './equation-shortcuts';

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
 * Something in the source that will not render, and the edit that repairs it.
 *
 * Every one of these is found by counting rather than by waiting for a typeset
 * to fail, so the panel can name the fault while the caret is still beside it.
 * That is also what makes the one-click repair honest: the fix comes out of the
 * same scan that found the fault, not out of a guess about what MathJax meant.
 */
export interface SourceProblem {
  span: SourceSpan;
  /** What to tell the user, in their words rather than TeX's. */
  message: string;
  /** Label for the button that applies `fix`. */
  action: string;
  /** The whole source repaired, and where the caret lands in it. */
  fix: SourceEdit;
}

/**
 * A brace that breaks the nesting.
 *
 * `kind` says which half of the pair is missing: an `extra` `}` closes a group
 * that was never opened, an `unclosed` `{` opens one that never ends.
 */
export interface BraceProblem extends SourceProblem {
  kind: 'unclosed' | 'extra';
}

/**
 * The brace that breaks the nesting: an unmatched `}`, or failing that the
 * innermost `{` that is never closed — the point past which everything the user
 * typed is inside a group they didn't mean to still be in.
 *
 * This is a counter over the source, so it answers about a half-typed
 * expression immediately, without waiting for a typeset to fail. The panel uses
 * that to point at the brace while the user is still near it; `locateLatexError`
 * uses the same answer to place MathJax's own complaint.
 */
export function unbalancedBrace(latex: string): BraceProblem | null {
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
      if (open.length === 0) {
        return {
          span: { index: i, length: 1 },
          kind: 'extra',
          message: 'This } closes nothing.',
          action: 'Remove it',
          // Nothing can be closed here, so the stray brace goes; the caret
          // stays where it was, which is where the user was reading.
          fix: { value: latex.slice(0, i) + latex.slice(i + 1), caret: i },
        };
      }
      open.pop();
    }
  }
  const unclosed = open.pop();
  if (unclosed === undefined) return null;
  return {
    span: { index: unclosed, length: 1 },
    kind: 'unclosed',
    message: 'This { is never closed.',
    action: 'Close it',
    // Closing at the end keeps everything already typed inside the group, which
    // is what an author who opened it and kept typing meant.
    fix: { value: `${latex}}`, caret: latex.length + 1 },
  };
}

/** Removing `length` characters at `index`, leaving the caret where they were. */
function deletion(latex: string, index: number, length: number): SourceEdit {
  return {
    value: latex.slice(0, index) + latex.slice(index + length),
    caret: index,
  };
}

/**
 * The closer each `\left` delimiter expects.
 *
 * `\right.` — the invisible delimiter — closes any opener, so one missing from
 * this table still gets a repair that renders. The table is worth keeping
 * anyway: someone who wrote `\left(` meant `\right)`, and closing it with
 * nothing visible is not the fix they were about to type.
 */
const MATCHING_DELIMITER: Record<string, string> = {
  '(': ')',
  '[': ']',
  '\\{': '\\}',
  '\\lbrace': '\\rbrace',
  '\\langle': '\\rangle',
  '\\lfloor': '\\rfloor',
  '\\lceil': '\\rceil',
  '|': '|',
  '\\|': '\\|',
  '.': '.',
};

/** The delimiter a `\left` or `\right` at `from` applies to. */
function delimiterAt(latex: string, from: number): string {
  return /^\s*(\\[a-zA-Z]+|\\[\s\S]|[\s\S])/.exec(latex.slice(from))?.[1] ?? '';
}

/**
 * Every `\command` in `latex`, as a fresh scanner.
 *
 * The single-character alternative is what keeps an escape from being read as a
 * command: in `a \\ \left(` the `\\` is consumed whole, so the `left` after it
 * belongs to its own backslash rather than to the line break.
 */
function commandScanner(): RegExp {
  return /\\([a-zA-Z]+|[\s\S])/g;
}

/**
 * A `\left` with no `\right`, or the other way about.
 *
 * TeX sizes the pair together, so one without the other is a hard failure —
 * and the message MathJax gives for it ("Extra \right" and friends) names a
 * command rather than a place. Counting them here points at the one that broke.
 */
export function unbalancedDelimiter(latex: string): SourceProblem | null {
  const open: { index: number; length: number; closer: string }[] = [];
  const pattern = commandScanner();
  let match = pattern.exec(latex);
  while (match) {
    const command = match[1];
    if (command === 'left') {
      const delimiter = delimiterAt(latex, match.index + match[0].length);
      open.push({
        index: match.index,
        length: match[0].length,
        closer: MATCHING_DELIMITER[delimiter] ?? '.',
      });
    } else if (command === 'right') {
      if (open.length === 0) {
        return {
          span: { index: match.index, length: match[0].length },
          message: String.raw`This \right closes nothing.`,
          action: 'Remove it',
          // Only the command goes. The bracket after it is ordinary math on its
          // own, so removing more than the message points at would delete
          // something the user never asked about.
          fix: deletion(latex, match.index, match[0].length),
        };
      }
      open.pop();
    }
    match = pattern.exec(latex);
  }
  const unclosed = open.pop();
  if (!unclosed) return null;
  const closing = String.raw`\right` + unclosed.closer;
  return {
    span: { index: unclosed.index, length: unclosed.length },
    message: String.raw`This \left is never closed.`,
    action: 'Close it',
    fix: { value: latex + closing, caret: latex.length + closing.length },
  };
}

/**
 * A `\begin` with no `\end`, an `\end` with no `\begin`, or a pair whose names
 * disagree.
 *
 * The last of those is the one worth the code: `\begin{aligned} … \end{align}`
 * is a plausible thing to type, and MathJax answers it with "Missing \end", a
 * message that describes neither the line the user is looking at nor the fix.
 */
export function unclosedEnvironment(latex: string): SourceProblem | null {
  const open: { index: number; name: string }[] = [];
  const pattern = /\\(begin|end)\{([^}]*)\}/g;
  let match = pattern.exec(latex);
  while (match) {
    const [text, keyword, name = ''] = match;
    if (keyword === 'begin') {
      open.push({ index: match.index, name });
    } else {
      const started = open.pop();
      if (!started) {
        return {
          span: { index: match.index, length: text.length },
          message: String.raw`This \end{${name}} closes nothing.`,
          action: 'Remove it',
          fix: deletion(latex, match.index, text.length),
        };
      }
      if (started.name !== name) {
        const corrected = String.raw`\end{${started.name}}`;
        return {
          span: { index: match.index, length: text.length },
          message: String.raw`This \end{${name}} should close \begin{${started.name}}.`,
          action: 'Fix it',
          fix: {
            value:
              latex.slice(0, match.index) +
              corrected +
              latex.slice(match.index + text.length),
            caret: match.index + corrected.length,
          },
        };
      }
    }
    match = pattern.exec(latex);
  }
  const unclosed = open.pop();
  if (!unclosed) return null;
  const closing = '\n' + String.raw`\end{${unclosed.name}}`;
  return {
    span: {
      index: unclosed.index,
      length: String.raw`\begin{${unclosed.name}}`.length,
    },
    message: String.raw`This \begin{${unclosed.name}} is never closed.`,
    action: 'Close it',
    fix: { value: latex + closing, caret: latex.length + closing.length },
  };
}

/**
 * A `$`, `$$`, `\[` or `\(` typed into a field that is already math.
 *
 * `normalizePastedLatex` strips these when they arrive on the clipboard, but
 * someone writing an equation from memory types the wrapper they would type in
 * a document — and MathJax answers with "Missing $ inserted", which reads as
 * though the fix were to add another one.
 *
 * Escapes are consumed before dollars are looked for, so the literal `\$` of a
 * price is left alone.
 */
export function strayDelimiter(latex: string): SourceProblem | null {
  const pattern = /\\[a-zA-Z]+|\\([[\]()])|\\[\s\S]|(\$\$?)/g;
  let match = pattern.exec(latex);
  while (match) {
    const found = match[1] ? `\\${match[1]}` : match[2];
    if (found) {
      return {
        span: { index: match.index, length: found.length },
        message: `${found} switches math on or off — this field is already inside an equation.`,
        action: 'Remove it',
        fix: deletion(latex, match.index, found.length),
      };
    }
    match = pattern.exec(latex);
  }
  return null;
}

/**
 * The first fault in `latex` that can be found by reading it, or `null` when
 * there is none.
 *
 * Earliest in the source wins where several detectors fire at once: a later
 * fault is often a consequence of an earlier one — an unclosed `{` swallows
 * every `\end` after it — and the earliest is the one whose repair is most
 * likely to settle the rest. Each repair fixes one fault; the hint re-reads the
 * result and names the next, if there still is one.
 */
export function sourceProblem(latex: string): SourceProblem | null {
  let first: SourceProblem | null = null;
  for (const problem of [
    unbalancedBrace(latex),
    unbalancedDelimiter(latex),
    unclosedEnvironment(latex),
    strayDelimiter(latex),
  ]) {
    if (problem && (!first || problem.span.index < first.span.index)) {
      first = problem;
    }
  }
  return first;
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
  if (UNBALANCED_BRACES.test(message)) {
    return unbalancedBrace(latex)?.span ?? null;
  }
  if (UNBALANCED_DELIMITERS.test(message)) {
    return unbalancedDelimiter(latex)?.span ?? null;
  }
  return null;
}

/** The source around a span, split so the span itself can be marked up. */
export interface SourceExcerpt {
  before: string;
  marked: string;
  after: string;
  /** Whether text was dropped from that end to fit the window. */
  clippedStart: boolean;
  clippedEnd: boolean;
}

/** Characters of context kept either side of a marked span. */
const EXCERPT_CONTEXT = 24;

/**
 * A short window of `latex` centred on `span`, for showing the user *where* the
 * failure is rather than telling them a line and column to go count out.
 *
 * A line/column pair is a compiler's answer: on the single-line expressions
 * this panel produces, "line 1" says nothing and a column means counting
 * characters in a proportional font. The text either side of the break is the
 * thing that actually locates it.
 */
export function sourceExcerpt(
  latex: string,
  span: SourceSpan,
  context: number = EXCERPT_CONTEXT,
): SourceExcerpt {
  const start = Math.max(0, Math.min(span.index, latex.length));
  const end = Math.max(start, Math.min(span.index + span.length, latex.length));
  const from = Math.max(0, start - context);
  const to = Math.min(latex.length, end + context);
  return {
    before: latex.slice(from, start),
    marked: latex.slice(start, end),
    after: latex.slice(end, to),
    clippedStart: from > 0,
    clippedEnd: to < latex.length,
  };
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
/**
 * Wrap `latex` in the delimiters for the style it is typeset in, the form it
 * has to be in to render inside a document.
 *
 * The panel's field holds the *body* of an equation, so copying it out bare
 * produces something that errors in every LaTeX document until the user wraps
 * it by hand — while paste, in the same panel, strips exactly these delimiters
 * on the way in. Math in, the same math out, in the same style.
 */
export function wrapMathLatex(latex: string, inline = false): string {
  const body = latex.trim();
  if (!body) return body;
  return inline ? `\\( ${body} \\)` : `\\[ ${body} \\]`;
}

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
