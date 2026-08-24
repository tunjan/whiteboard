import { describe, expect, it } from 'vitest';
import {
  applyLatexCompletion,
  fillSnippet,
  latexTokenAt,
  matchLatexCompletions,
  snippetCaret,
  LATEX_COMPLETIONS,
} from './equation-complete';

describe('finding the command being typed', () => {
  it('reads back over the letters to the backslash', () => {
    expect(latexTokenAt('x + \\fra', 8)).toEqual({ index: 4, text: '\\fra' });
  });

  it('offers everything for a bare backslash', () => {
    expect(latexTokenAt('\\', 1)).toEqual({ index: 0, text: '\\' });
  });

  it('ignores a caret that has left the token', () => {
    expect(latexTokenAt('\\frac{x}', 8)).toBeNull();
    expect(latexTokenAt('x + 1', 5)).toBeNull();
  });

  it('ignores an escaped backslash, which is a line break', () => {
    expect(latexTokenAt('a \\\\', 4)).toBeNull();
  });
});

describe('ranking completions', () => {
  it('puts an exact prefix before a mere substring', () => {
    const [first] = matchLatexCompletions('\\al');
    expect(first?.command).toBe('\\alpha');
  });

  it('finds a command no prefix of the query would', () => {
    const commands = matchLatexCompletions('\\eps').map((c) => c.command);
    expect(commands).toContain('\\varepsilon');
  });

  it('returns nothing for letters no command contains', () => {
    expect(matchLatexCompletions('\\qqzz')).toEqual([]);
  });

  it('honours the limit', () => {
    expect(matchLatexCompletions('\\', 3)).toHaveLength(3);
  });
});

describe('accepting a completion', () => {
  it('replaces the token and lands the caret in the first slot', () => {
    const value = 'x + \\fr';
    const token = latexTokenAt(value, value.length);
    const frac = LATEX_COMPLETIONS.find((c) => c.command === '\\frac');
    expect(token && frac).toBeTruthy();
    const next = applyLatexCompletion(value, token!, frac!);
    expect(next.value).toBe('x + \\frac{}{}');
    expect(next.value.slice(0, next.caret)).toBe('x + \\frac{');
  });

  it('lands the caret at the end when the snippet has no slot', () => {
    expect(snippetCaret('\\alpha')).toBe('\\alpha'.length);
  });
});

// Typing `\` over a selection deletes it, the way typing over a selection
// always does. What the panel remembers of it comes back here, so the command
// being typed wraps the text instead of discarding it.
describe('accepting a completion over selected text', () => {
  it('fills the first slot and waits in the second', () => {
    const value = 'a = \\fr';
    const token = latexTokenAt(value, value.length);
    const frac = LATEX_COMPLETIONS.find((c) => c.command === '\\frac');
    const next = applyLatexCompletion(value, token!, frac!, 'x + 1');

    expect(next.value).toBe('a = \\frac{x + 1}{}');
    expect(next.value.slice(0, next.caret)).toBe('a = \\frac{x + 1}{');
  });

  it('lands at the end when the snippet had only the one slot', () => {
    const { insert, caret } = fillSnippet('\\sqrt{}', 'x + 1');

    expect(insert).toBe('\\sqrt{x + 1}');
    expect(caret).toBe(insert.length);
  });

  it('steps over a selection that contains slots of its own', () => {
    const { insert, caret } = fillSnippet('\\sum_{}^{}', '\\frac{}{}');

    expect(insert).toBe('\\sum_{\\frac{}{}}^{}');
    expect(insert.slice(0, caret)).toBe('\\sum_{\\frac{}{}}^{');
  });

  it('replaces the text when the command has nowhere to put it', () => {
    expect(fillSnippet('\\alpha', 'x + 1')).toEqual({
      insert: '\\alpha',
      caret: '\\alpha'.length,
    });
  });

  it('behaves as before when nothing was selected', () => {
    expect(fillSnippet('\\frac{}{}', '')).toEqual({
      insert: '\\frac{}{}',
      caret: snippetCaret('\\frac{}{}'),
    });
  });
});
