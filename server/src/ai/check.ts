import {
  MAX_CHECK_ERRORS,
  MAX_CHECK_SOURCE_CHARS,
  MAX_CHECK_SOURCES,
  MAX_LATEX_CHARS,
  type CheckError,
  type CheckSource,
} from '@whiteboard/shared';

/**
 * The work checker's prompt, and the parsing that turns its reply into the
 * mistakes the client pins to the board.
 *
 * The reply is untrusted the same way the agent's tool calls are: every string
 * is capped and every line number range-checked, and an entry that doesn't fit
 * is dropped rather than failing the others.
 *
 * Mistakes are located by the numbered tags the client draws in the image's
 * margin, not by coordinates. Measured 2026-10-24 on a six-line page: asked
 * for 0–1000 boxes, jev-router answered in pixels on one run and in neither
 * convention on the next, and DeepSeek was off by a line; asked for a tag
 * number, both named the right line on every run.
 */

export const CHECK_SYSTEM_PROMPT = [
  'You check a student\'s mathematical working in an image for mistakes. It may be handwritten, typeset, or a mixture, on a light or dark background.',
  'Each line of working is numbered by a blue tag in the left margin. The tags are not part of the working.',
  'The message may give the exact source of the typeset parts of some lines, by tag. Trust it over your reading of those parts. A line can mix handwriting and typeset maths, so that text may be only part of the line: the image always shows the whole line.',

  'WHAT COUNTS',
  'Report only real mathematical errors: a wrong calculation, sign, algebraic step, rule, substitution, or a conclusion that does not follow.',
  'Do not report style, notation preferences, missing steps that are not wrong, or working that is simply unfinished. A step is wrong only if it does not follow from what came before it.',
  'When one mistake carries through later lines, report only the first line where it happens.',
  'If you are not sure a step is wrong, do not report it.',

  'OUTPUT',
  'Reply with one JSON object and nothing else: {"errors": [...]}.',
  'Each error is {"line": <tag number>, "message": "...", "correction": "..."}.',
  '- message: one or two short sentences saying what is wrong and why, written to the student. Put mathematics between $ signs, e.g. "$3^2$ is $9$, not $6$."',
  '- correction: that whole line written correctly, as a LaTeX body with no $ delimiters. Omit it if no single line fixes the mistake.',
  `At most ${MAX_CHECK_ERRORS} errors. If the working is correct, or the image holds no mathematics, reply {"errors": []}.`,
].join('\n');

const MAX_MESSAGE_CHARS = 500;

/** Far past any page anyone writes; the client ignores a tag it didn't draw. */
const MAX_LINE = 500;

/** A LaTeX body: models sometimes wrap it in `$…$` despite the prompt. */
function correctionOf(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const latex = value.trim().replace(/^\$+|\$+$/g, '').trim();
  // Truncated LaTeX is broken LaTeX, so an overlong one is dropped, not cut.
  return latex && latex.length <= MAX_LATEX_CHARS ? latex : undefined;
}

/** The JSON object in a reply; fences or a sentence of preamble are tolerated. */
function jsonObjectIn(reply: string): unknown {
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start === -1 || end < start) return null;
  try {
    return JSON.parse(reply.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * The mistakes in a reply, or null when the reply holds no JSON object at all —
 * a fault, unlike an empty list, which is the answer "this is correct".
 */
export function parseCheckReply(reply: string): CheckError[] | null {
  const errors = (jsonObjectIn(reply) as { errors?: unknown } | null)?.errors;
  if (!Array.isArray(errors)) return null;

  const result: CheckError[] = [];
  for (const entry of errors) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const line = e.line;
    const message =
      typeof e.message === 'string' ? e.message.trim().slice(0, MAX_MESSAGE_CHARS) : '';
    if (!Number.isInteger(line) || (line as number) < 1 || (line as number) > MAX_LINE) continue;
    if (!message) continue;
    const correction = correctionOf(e.correction);
    result.push({ line: line as number, message, ...(correction ? { correction } : {}) });
    if (result.length === MAX_CHECK_ERRORS) break;
  }
  return result;
}

/**
 * The typeset sources a client posted, from untrusted input: a malformed or
 * overlong entry is dropped, never the request, and anything but an array —
 * including no field at all, from an older client — is none.
 */
export function parseCheckSources(value: unknown): CheckSource[] {
  if (!Array.isArray(value)) return [];
  const result: CheckSource[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const { line, kind, source } = entry as Record<string, unknown>;
    if (!Number.isInteger(line) || (line as number) < 1 || (line as number) > MAX_LINE) continue;
    if (kind !== 'latex' && kind !== 'text') continue;
    if (typeof source !== 'string') continue;
    // One source per row of the message: a newline must not start another.
    const text = source.replace(/\s+/g, ' ').trim();
    if (!text || text.length > MAX_CHECK_SOURCE_CHARS) continue;
    result.push({ line: line as number, kind, source: text });
    if (result.length === MAX_CHECK_SOURCES) break;
  }
  return result;
}

function sourcesText(sources: CheckSource[]): string {
  if (!sources.length) return '';
  return [
    '',
    'Exact source of the typeset parts, by line tag. A line may hold more than this; the image shows all of it.',
    ...sources.map(
      (s) => `Line ${s.line} (${s.kind === 'latex' ? 'LaTeX' : 'text'}): ${s.source}`,
    ),
  ].join('\n');
}

/** The user message beside the image. */
export function checkInstruction(sources: CheckSource[]): string {
  return `Check this working for mistakes.${sourcesText(sources)}`;
}

/**
 * The confirmation pass. An always-on checker's expensive failure is a false
 * positive, so a second call, shown the same image, has to agree with each
 * claimed mistake before it is pinned. Asked to judge claims, not to find
 * mistakes, it answers with claim numbers only: what is pinned is still the
 * first reply's wording and correction.
 */
export const CONFIRM_SYSTEM_PROMPT = [
  'You review claims that a student\'s mathematical working in an image contains mistakes. It may be handwritten, typeset, or a mixture.',
  'Each line of working is numbered by a blue tag in the left margin. The tags are not part of the working.',
  'For each numbered claim, look at that line yourself and decide independently whether it really holds the mathematical error claimed: a wrong calculation, sign, algebraic step, rule, substitution, or a conclusion that does not follow from the lines before it.',
  'Reject a claim that misreads the writing, objects to style or notation, calls unfinished working wrong, or that you are not sure of.',
  'Reply with one JSON object and nothing else: {"confirmed": [<claim numbers that hold>]}, or {"confirmed": []} if none do.',
].join('\n');

export function confirmInstruction(errors: CheckError[], sources: CheckSource[]): string {
  return [
    'Verify these claimed mistakes.',
    ...errors.map((e, i) => `Claim ${i + 1}, line ${e.line}: ${e.message}`),
  ].join('\n') + sourcesText(sources);
}

/**
 * The claim numbers (from 1) a confirmation reply upholds, or null when it
 * holds no usable answer — the caller then keeps the first reply as it was.
 */
export function parseConfirmReply(reply: string, claims: number): number[] | null {
  const confirmed = (jsonObjectIn(reply) as { confirmed?: unknown } | null)?.confirmed;
  if (!Array.isArray(confirmed)) return null;
  return [
    ...new Set(
      confirmed.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= claims),
    ),
  ];
}
