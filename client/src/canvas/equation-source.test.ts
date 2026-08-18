import { describe, expect, it } from 'vitest';
import {
  locateLatexError,
  normalizePastedLatex,
  readableError,
  sourcePosition,
} from './equation-source';

describe('rewriting MathJax errors', () => {
  it('names the misspelled command', () => {
    expect(readableError('Undefined control sequence: \\fracc')).toBe(
      'Unknown command \\fracc — check the spelling.',
    );
  });

  // Deep enough nesting overflows the converter before MathJax can judge the
  // TeX, and the raw text describes our renderer rather than the equation.
  it('explains an engine failure in terms of the expression', () => {
    expect(readableError('Maximum call stack size exceeded')).toBe(
      'This expression is nested too deeply to render — try splitting it into separate equations.',
    );
    expect(readableError('InternalError: too much recursion')).toBe(
      'This expression is nested too deeply to render — try splitting it into separate equations.',
    );
  });

  it('passes through messages it has nothing better to say about', () => {
    expect(readableError('Misplaced alignment tab character &')).toBe(
      'Misplaced alignment tab character &',
    );
  });
});

describe('locating an error in the source', () => {
  it('points at the unknown command', () => {
    expect(
      locateLatexError('x + \\fracc{1}{2}', 'Undefined control sequence: \\fracc'),
    ).toEqual({ index: 4, length: 6 });
  });

  it('skips a command that only shares a prefix with the bad one', () => {
    // \fra must not match inside the \frac that follows it.
    expect(
      locateLatexError('\\frac{a}{b} + \\fra', 'Undefined control sequence: \\fra'),
    ).toEqual({ index: 14, length: 4 });
  });

  it('points at a closing brace that never opened', () => {
    expect(locateLatexError('x^2} + 1', 'Extra close brace')).toEqual({
      index: 3,
      length: 1,
    });
  });

  it('points at the innermost brace left open', () => {
    expect(
      locateLatexError('\\frac{a{b}', 'Missing close brace'),
    ).toEqual({ index: 5, length: 1 });
  });

  it('ignores escaped braces, which are glyphs rather than grouping', () => {
    expect(locateLatexError('\\{a\\}', 'Missing close brace')).toBeNull();
  });

  it('leaves an error it cannot place unlocated', () => {
    expect(locateLatexError('x^2', 'Misplaced alignment tab character &')).toBeNull();
  });
});

describe('reporting a position in the source', () => {
  it('counts from one on a single line', () => {
    expect(sourcePosition('x + y', 4)).toEqual({ line: 1, column: 5 });
  });

  it('restarts the column on each line', () => {
    // Index 7 is the '+' on the second line: b, space, plus.
    expect(sourcePosition('a \\\\\nb + c', 7)).toEqual({ line: 2, column: 3 });
  });
});

describe('normalizing pasted LaTeX', () => {
  it('unwraps display delimiters', () => {
    expect(normalizePastedLatex('$$\\frac{a}{b}$$')).toBe('\\frac{a}{b}');
    expect(normalizePastedLatex('\\[\\frac{a}{b}\\]')).toBe('\\frac{a}{b}');
    expect(normalizePastedLatex('\\(x^2\\)')).toBe('x^2');
    expect(normalizePastedLatex('$x^2$')).toBe('x^2');
  });

  it('ignores surrounding whitespace when a wrapper is present', () => {
    expect(normalizePastedLatex('  $$ x^2 $$\n')).toBe('x^2');
  });

  it('leaves two wrapped expressions alone rather than splicing them', () => {
    expect(normalizePastedLatex('$a$ + $b$')).toBe('$a$ + $b$');
    expect(normalizePastedLatex('$$a$$ and $$b$$')).toBe('$$a$$ and $$b$$');
  });

  it('returns unwrapped text exactly as copied', () => {
    expect(normalizePastedLatex(' + 1 ')).toBe(' + 1 ');
    expect(normalizePastedLatex('x^2')).toBe('x^2');
  });

  it('leaves a bare delimiter alone', () => {
    expect(normalizePastedLatex('$$')).toBe('$$');
    expect(normalizePastedLatex('$')).toBe('$');
  });
});
