/**
 * LaTeX command completion for the equation panel's source field.
 *
 * The panel is a plain textarea now, so the only way to find `\varepsilon`
 * without knowing it already is to type `\v` and be shown the options — the
 * same trade the Quick LaTeX Obsidian plugin makes: raw source, plus enough
 * assistance that raw source is faster than a symbol palette.
 *
 * Kept apart from the panel so it stays plain, testable data.
 */

export interface LatexCompletion {
  /** The command as typed, and what the list matches against. */
  command: string;
  /** What replaces the typed token. An empty group marks a slot to fill. */
  insert: string;
  /** What the command produces, in words or in glyphs. */
  hint: string;
}

/**
 * Where the caret belongs after `snippet` lands: inside its first empty group,
 * or at the end when the snippet has no slot to fill.
 */
export function snippetCaret(snippet: string): number {
  const at = snippet.indexOf('{}');
  return at === -1 ? snippet.length : at + 1;
}

/**
 * `snippet` with `text` written into its first empty group, and where the caret
 * goes afterwards: the *next* slot, since the first one is now filled.
 *
 * This is what makes a completion able to wrap something already written —
 * `x + 1` selected and `\frac` typed becomes `\frac{x + 1}{}`, with the caret
 * waiting in the denominator rather than back at the start of the numerator the
 * user just retyped.
 *
 * A snippet with no slot has nowhere to put the text, so the text is dropped:
 * `\alpha` is a glyph, and typing a glyph over a selection replaces it here for
 * the same reason it does in any other text field.
 */
export function fillSnippet(
  snippet: string,
  text: string,
): { insert: string; caret: number } {
  const at = text ? snippet.indexOf('{}') : -1;
  if (at === -1) return { insert: snippet, caret: snippetCaret(snippet) };
  const insert = snippet.slice(0, at + 1) + text + snippet.slice(at + 1);
  // Searching past the text keeps a selection that itself contains `{}` from
  // being mistaken for the slot to fill next.
  const next = insert.indexOf('{}', at + 1 + text.length);
  return { insert, caret: next === -1 ? insert.length : next + 1 };
}

/** A `\command` token being typed, as an offset and its text. */
export interface LatexToken {
  index: number;
  text: string;
}

/**
 * The command token ending at `caret`, if the caret sits in one.
 *
 * A token is a backslash and the letters after it, with nothing in between —
 * so `\fra|` is one and `\frac{x|` is not. The backslash has to be a real one:
 * in `\\|` the second slash is escaped, and starts a line break rather than a
 * command.
 */
export function latexTokenAt(value: string, caret: number): LatexToken | null {
  let start = Math.max(0, Math.min(caret, value.length));
  while (start > 0 && /[a-zA-Z]/.test(value[start - 1] as string)) start -= 1;
  if (value[start - 1] !== '\\') return null;
  let slashes = 0;
  for (let i = start - 1; i >= 0 && value[i] === '\\'; i -= 1) slashes += 1;
  if (slashes % 2 === 0) return null;
  return { index: start - 1, text: value.slice(start - 1, caret) };
}

/**
 * Completions for `token`, best first.
 *
 * Ranked in three tiers — exact prefix, prefix ignoring case, then anything
 * containing the letters — so `\al` offers `\alpha` before `\Alpha`-like
 * capitals, and `\eps` still finds `\varepsilon`, which no prefix of it does.
 */
export function matchLatexCompletions(
  token: string,
  limit = 8,
): LatexCompletion[] {
  const query = token.replace(/^\\/, '');
  if (!query) return LATEX_COMPLETIONS.slice(0, limit);
  const lower = query.toLowerCase();
  const tiers: LatexCompletion[][] = [[], [], []];
  for (const completion of LATEX_COMPLETIONS) {
    const name = completion.command.slice(1);
    const tier = name.startsWith(query)
      ? 0
      : name.toLowerCase().startsWith(lower)
        ? 1
        : name.toLowerCase().includes(lower)
          ? 2
          : -1;
    if (tier >= 0) tiers[tier]?.push(completion);
  }
  return tiers.flat().slice(0, limit);
}

/**
 * The source and caret after `completion` replaces `token`.
 *
 * `wrapped` is text the token was typed over — see `fillSnippet`, which decides
 * where in the snippet it lands.
 */
export function applyLatexCompletion(
  value: string,
  token: LatexToken,
  completion: LatexCompletion,
  wrapped = '',
): { value: string; caret: number } {
  const end = token.index + token.text.length;
  const { insert, caret } = fillSnippet(completion.insert, wrapped);
  return {
    value: value.slice(0, token.index) + insert + value.slice(end),
    caret: token.index + caret,
  };
}

const g = (command: string, hint: string): LatexCompletion => ({
  command,
  insert: command,
  hint,
});
const slot = (
  command: string,
  insert: string,
  hint: string,
): LatexCompletion => ({ command, insert, hint });

/**
 * The commands worth offering, ordered so that an empty query shows the ones
 * reached for by the hour rather than the alphabet's opinion.
 *
 * Not a complete TeX index — MathJax accepts hundreds more, and a list that
 * long stops being a suggestion and becomes a search problem. What is here is
 * the structures, the Greek alphabet, and the relations that a whiteboard
 * equation actually gets built out of.
 */
export const LATEX_COMPLETIONS: LatexCompletion[] = [
  slot('\\frac', '\\frac{}{}', 'fraction'),
  slot('\\sqrt', '\\sqrt{}', 'square root'),
  slot('\\sum', '\\sum_{}^{}', 'sum with limits'),
  slot('\\prod', '\\prod_{}^{}', 'product with limits'),
  slot('\\int', '\\int_{}^{}', 'integral with limits'),
  slot('\\oint', '\\oint_{}^{}', 'contour integral'),
  slot('\\lim', '\\lim_{ \\to }', 'limit'),
  slot('\\binom', '\\binom{}{}', 'binomial coefficient'),
  slot(
    '\\begin{aligned}',
    '\\begin{aligned}\n  {} &= \n\\end{aligned}',
    'aligned equations',
  ),
  slot(
    '\\begin{cases}',
    '\\begin{cases}\n  {} & \\\\\n  & \n\\end{cases}',
    'cases',
  ),
  slot(
    '\\begin{pmatrix}',
    '\\begin{pmatrix}\n  {} & \\\\\n  & \n\\end{pmatrix}',
    'matrix, ( )',
  ),
  slot(
    '\\begin{bmatrix}',
    '\\begin{bmatrix}\n  {} & \\\\\n  & \n\\end{bmatrix}',
    'matrix, [ ]',
  ),
  slot('\\left(', '\\left( {} \\right)', 'sized brackets'),
  slot('\\left[', '\\left[ {} \\right]', 'sized brackets'),
  slot('\\left\\lVert', '\\left\\lVert {} \\right\\rVert', 'norm'),
  slot('\\text', '\\text{}', 'upright text'),
  slot('\\mathbb', '\\mathbb{}', 'blackboard bold, ℝ'),
  slot('\\mathcal', '\\mathcal{}', 'script, ℱ'),
  slot('\\mathbf', '\\mathbf{}', 'bold'),
  slot('\\mathrm', '\\mathrm{}', 'upright'),
  slot('\\vec', '\\vec{}', 'vector arrow'),
  slot('\\hat', '\\hat{}', 'hat'),
  slot('\\bar', '\\bar{}', 'bar'),
  slot('\\dot', '\\dot{}', 'dot'),
  slot('\\tilde', '\\tilde{}', 'tilde'),
  slot('\\overline', '\\overline{}', 'overline'),
  slot('\\underbrace', '\\underbrace{}_{}', 'under-brace with label'),
  slot('\\substack', '\\substack{}', 'stacked limits'),
  g('\\alpha', 'α'),
  g('\\beta', 'β'),
  g('\\gamma', 'γ'),
  g('\\Gamma', 'Γ'),
  g('\\delta', 'δ'),
  g('\\Delta', 'Δ'),
  g('\\epsilon', 'ϵ'),
  g('\\varepsilon', 'ε'),
  g('\\zeta', 'ζ'),
  g('\\eta', 'η'),
  g('\\theta', 'θ'),
  g('\\Theta', 'Θ'),
  g('\\vartheta', 'ϑ'),
  g('\\iota', 'ι'),
  g('\\kappa', 'κ'),
  g('\\lambda', 'λ'),
  g('\\Lambda', 'Λ'),
  g('\\mu', 'μ'),
  g('\\nu', 'ν'),
  g('\\xi', 'ξ'),
  g('\\Xi', 'Ξ'),
  g('\\pi', 'π'),
  g('\\Pi', 'Π'),
  g('\\rho', 'ρ'),
  g('\\sigma', 'σ'),
  g('\\Sigma', 'Σ'),
  g('\\tau', 'τ'),
  g('\\upsilon', 'υ'),
  g('\\phi', 'ϕ'),
  g('\\varphi', 'φ'),
  g('\\Phi', 'Φ'),
  g('\\chi', 'χ'),
  g('\\psi', 'ψ'),
  g('\\Psi', 'Ψ'),
  g('\\omega', 'ω'),
  g('\\Omega', 'Ω'),
  g('\\infty', '∞'),
  g('\\partial', '∂'),
  g('\\nabla', '∇'),
  g('\\cdot', '·'),
  g('\\cdots', '⋯'),
  g('\\ldots', '…'),
  g('\\times', '×'),
  g('\\div', '÷'),
  g('\\pm', '±'),
  g('\\mp', '∓'),
  g('\\leq', '≤'),
  g('\\geq', '≥'),
  g('\\neq', '≠'),
  g('\\approx', '≈'),
  g('\\equiv', '≡'),
  g('\\sim', '∼'),
  g('\\propto', '∝'),
  g('\\in', '∈'),
  g('\\notin', '∉'),
  g('\\subset', '⊂'),
  g('\\subseteq', '⊆'),
  g('\\cup', '∪'),
  g('\\cap', '∩'),
  g('\\emptyset', '∅'),
  g('\\forall', '∀'),
  g('\\exists', '∃'),
  g('\\neg', '¬'),
  g('\\land', '∧'),
  g('\\lor', '∨'),
  g('\\to', '→'),
  g('\\mapsto', '↦'),
  g('\\rightarrow', '→'),
  g('\\leftarrow', '←'),
  g('\\Rightarrow', '⇒'),
  g('\\Leftrightarrow', '⇔'),
  g('\\angle', '∠'),
  g('\\perp', '⊥'),
  g('\\parallel', '∥'),
  g('\\degree', '°'),
  g('\\sin', 'sine'),
  g('\\cos', 'cosine'),
  g('\\tan', 'tangent'),
  g('\\log', 'logarithm'),
  g('\\ln', 'natural log'),
  g('\\exp', 'exponential'),
  g('\\min', 'minimum'),
  g('\\max', 'maximum'),
  g('\\quad', 'wide space'),
  g('\\qquad', 'wider space'),
];
