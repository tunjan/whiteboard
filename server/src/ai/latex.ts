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
 *
 * Handwriting and print are named together because the same endpoint serves
 * both: the client rasterizes whatever was selected, which may be a scrawl, a
 * pasted screenshot of a textbook, or a photograph with working over it.
 *
 * Grouped and newline-separated rather than run together as prose: this is a
 * checklist meant to be applied glyph by glyph, and the headings are what let a
 * later reader see which failure each line is paying for.
 *
 * - *Output* is the contract with `extractLatex` and with MathJax. Everything
 *   here is rendered by `equation-convert`, which runs TeX maths only — a reply
 *   carrying `\usepackage`, `\newcommand` or a `tikzpicture` does not degrade,
 *   it fails to typeset and lands on the board as an error box.
 * - *Reading the page* is the transcription itself, and where the accuracy is
 *   won or lost: handwriting is two-dimensional and LaTeX is a string, so a
 *   fraction bar read as a minus sign turns a right answer into a plausible
 *   wrong one.
 * - *Ambiguous glyphs* names the pairs a hand genuinely makes undecidable in
 *   isolation. Deciding from context and then staying consistent is what a
 *   human reader does, and saying so beats letting the model re-decide per
 *   line.
 * - *Words* is what makes prose survive the trip. Everything is typeset in
 *   math mode, where a bare "where" is not a word but five italic variables
 *   multiplied together — wrong-looking, and wrongly spaced. Printed sources
 *   carry far more of this than handwriting does (captions, step labels,
 *   units), which is what makes the rule worth spending prompt on. The
 *   escaping line is not pedantry: an unescaped `%` is a TeX comment, so a
 *   transcribed "50%" silently deletes the rest of the line.
 * - *When to refuse* keeps the sentinel narrow. The diagram case is the one
 *   that matters — a figure cannot be drawn here at all, so it is a refusal
 *   only when no formula stands beside it.
 */
export const INK_SYSTEM_PROMPT = [
  'You transcribe the mathematics in an image into LaTeX. It may be handwritten, printed, photographed, or a mixture, and the ink may be dark on light or light on dark.',

  'OUTPUT',
  'Reply with one LaTeX body and nothing else: no $ or \\[ delimiters, no code fences, no prose, no explanation, no TeX comments.',
  'The result is rendered by MathJax in math mode. Use only TeX mathematics commands and standard environments (aligned, cases, array, pmatrix, bmatrix). Never emit \\documentclass, \\usepackage, \\begin{document}, \\newcommand, \\label, \\ref, or a tikzpicture.',

  'READING THE PAGE',
  'Transcribe exactly what is written. Never solve, simplify, evaluate, correct or continue the mathematics; copy a mistake as it stands.',
  'Read top to bottom, then left to right, and leave out anything the writer struck through.',
  'A horizontal bar with something above and below it is \\frac, not a minus sign. A radical covers exactly what its bar spans: \\sqrt{...}.',
  'Read superscripts and subscripts from their position: x^2, a_1, a raised tick as a prime.',
  'Anything written above or below a \\sum, \\int, \\prod or \\lim is its superscript or subscript.',
  'Keep the delimiters that were drawn, and use \\left...\\right where they enclose something tall.',
  'A brace opening onto stacked conditions is \\begin{cases}; a bracketed grid is pmatrix or bmatrix, matching the bracket drawn.',
  'Carry accents over: \\vec, \\hat, \\bar, \\dot, \\overline, \\widehat.',
  "Keep the writer's line breaks: multiple lines go inside \\begin{aligned}...\\end{aligned}, separated by \\\\ and lined up with & at the relation symbol.",
  'Where a single symbol is genuinely illegible, transcribe everything else and put \\text{?} in its place rather than guessing.',

  'AMBIGUOUS GLYPHS',
  'Decide the pairs a hand makes ambiguous — x and \\times, l and 1, O and 0, z and 2, S and 5, a decimal point and a product dot — from the surrounding mathematics, and read the same glyph the same way throughout the image.',
  'A written multiplication cross is \\times and a raised dot is \\cdot; juxtaposition stays juxtaposition.',

  'WORDS',
  'Wrap every word, label, caption and unit in \\text{...}, or \\textbf{...} where the source is bold: "where", "Step 2", "Theorem", "m/s".',
  'Inside \\text, escape \\%, \\&, \\#, \\_, \\{ and \\} — an unescaped % comments out the rest of the line.',
  'Operator names keep their own commands — \\sin, \\log, \\max, \\lim — never \\text.',

  'WHEN TO REFUSE',
  `Reply with exactly ${LATEX_UNREADABLE}, and nothing else, only when the image holds no legible mathematics at all.`,
  'A diagram, graph or geometric figure cannot be drawn in this LaTeX: transcribe the formulas and labelled expressions written beside it, and refuse only if there are none.',
].join('\n');

/**
 * Naming a formula rather than dictating one: "quadratic formula" has to come
 * back as the formula, so this half of the feature is recall, where the ink
 * half is forbidden from recalling anything.
 */
export const PROMPT_SYSTEM_PROMPT = [
  'You write LaTeX for mathematics described in plain language.',
  'Reply with the LaTeX body only: no $ or \\[ delimiters, no code fences, no prose, no explanation.',
  'Named results are written out in full — "quadratic formula" is the formula itself, not the words.',
  'Any word, label or unit that belongs in the output is wrapped in \\text{...}: it is typeset in math mode, where bare words set as italic variables.',
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
