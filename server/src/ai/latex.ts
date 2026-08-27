import { LATEX_UNREADABLE, MAX_LATEX_CHARS } from '@whiteboard/shared';

/**
 * The prompts, and the unwrapping that turns a chat reply into something the
 * equation shape can hold.
 *
 * Kept free of network and Hono types so the parsing — the part that decides
 * what actually lands on a collaborator's board — can be tested directly.
 */

/**
 * Transcription, not solving. A model asked to "read this" will otherwise
 * helpfully finish the working, and the user gets an answer where they drew a
 * question. The delimiter and prose rules exist because the reply is written
 * straight into `EquationProps.latex`, which is a body — `$…$` around it would
 * typeset as literal dollar signs, and a sentence would fail to parse.
 */
export const INK_SYSTEM_PROMPT = [
  'You transcribe handwritten mathematics into LaTeX.',
  'Reply with the LaTeX body only: no $ or \\[ delimiters, no code fences, no prose, no explanation.',
  'Transcribe exactly what is written. Never solve, simplify, correct, or continue the mathematics.',
  'Use \\frac, ^, _, \\sqrt, \\int, \\sum and standard commands. Use an aligned environment for multiple lines.',
  `If the image contains no legible mathematics, reply with exactly ${LATEX_UNREADABLE} and nothing else.`,
].join(' ');

/**
 * Naming a formula rather than dictating one: "quadratic formula" has to come
 * back as the formula, so this half of the feature is recall, where the ink
 * half is forbidden from recalling anything.
 */
export const PROMPT_SYSTEM_PROMPT = [
  'You write LaTeX for mathematics described in plain language.',
  'Reply with the LaTeX body only: no $ or \\[ delimiters, no code fences, no prose, no explanation.',
  'Named results are written out in full — "quadratic formula" is the formula itself, not the words.',
  'Use an aligned environment for multiple lines.',
  `If the description names nothing you can write as mathematics, reply with exactly ${LATEX_UNREADABLE} and nothing else.`,
].join(' ');

/** Math delimiter pairs a model wraps its answer in despite being told not to. */
const DELIMITERS: [string, string][] = [
  ['$$', '$$'],
  ['\\[', '\\]'],
  ['\\(', '\\)'],
  ['$', '$'],
];

/**
 * Environments that are display math rather than structure. The shape already
 * typesets in display style, so an outer `equation` only adds a tag number;
 * `align`, `cases` and `matrix` are load-bearing and are left alone.
 */
const DISPLAY_ENVIRONMENTS = /^\\begin\{(equation\*?|displaymath)\}([\s\S]*)\\end\{\1\}$/;

/** Strip one ```…``` fence, with or without a language tag. */
function stripCodeFence(text: string): string {
  const match = /^```[^\n]*\n([\s\S]*?)\n?```$/.exec(text);
  return match?.[1]?.trim() ?? text;
}

function stripDelimiters(text: string): string {
  for (const [open, close] of DELIMITERS) {
    if (
      text.length > open.length + close.length &&
      text.startsWith(open) &&
      text.endsWith(close)
    ) {
      return text.slice(open.length, -close.length).trim();
    }
  }
  return text;
}

export type LatexExtraction =
  | { latex: string }
  | { latex?: never; reason: 'empty' | 'unreadable' | 'too-long' };

/**
 * Unwrap a chat reply into a LaTeX body.
 *
 * Unwrapping runs to a fixed point because the wrappers nest: a model that
 * ignores both rules answers with a fenced block containing `$$…$$`, and
 * peeling one layer would leave the other on the board.
 */
export function extractLatex(raw: string): LatexExtraction {
  let text = raw.trim();
  for (let i = 0; i < 4; i++) {
    const next = stripDelimiters(stripCodeFence(text));
    const env = DISPLAY_ENVIRONMENTS.exec(next);
    const unwrapped = env?.[2]?.trim() ?? next;
    if (unwrapped === text) break;
    text = unwrapped;
  }

  if (!text) return { reason: 'empty' };
  // Checked after unwrapping: the sentinel arrives fenced often enough.
  if (text === LATEX_UNREADABLE) return { reason: 'unreadable' };
  if (text.length > MAX_LATEX_CHARS) return { reason: 'too-long' };
  return { latex: text };
}
