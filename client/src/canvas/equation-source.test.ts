import { describe, expect, it } from 'vitest';
import {
  locateLatexError,
  normalizePastedLatex,
  readableError,
  sourceExcerpt,
  sourceProblem,
  strayDelimiter,
  unbalancedBrace,
  unbalancedDelimiter,
  unclosedEnvironment,
  wrapMathLatex,
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
      locateLatexError(
        'x + \\fracc{1}{2}',
        'Undefined control sequence: \\fracc',
      ),
    ).toEqual({ index: 4, length: 6 });
  });

  it('skips a command that only shares a prefix with the bad one', () => {
    // \fra must not match inside the \frac that follows it.
    expect(
      locateLatexError(
        '\\frac{a}{b} + \\fra',
        'Undefined control sequence: \\fra',
      ),
    ).toEqual({ index: 14, length: 4 });
  });

  it('points at a closing brace that never opened', () => {
    expect(locateLatexError('x^2} + 1', 'Extra close brace')).toEqual({
      index: 3,
      length: 1,
    });
  });

  it('points at the innermost brace left open', () => {
    expect(locateLatexError('\\frac{a{b}', 'Missing close brace')).toEqual({
      index: 5,
      length: 1,
    });
  });

  it('ignores escaped braces, which are glyphs rather than grouping', () => {
    expect(locateLatexError('\\{a\\}', 'Missing close brace')).toBeNull();
  });

  it('leaves an error it cannot place unlocated', () => {
    expect(
      locateLatexError('x^2', 'Misplaced alignment tab character &'),
    ).toBeNull();
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

describe('excerpting the source around a failure', () => {
  it('splits the span out of its surroundings', () => {
    const latex = 'a + \\fract{1}{2}';
    expect(sourceExcerpt(latex, { index: 4, length: 6 })).toEqual({
      before: 'a + ',
      marked: '\\fract',
      after: '{1}{2}',
      clippedStart: false,
      clippedEnd: false,
    });
  });

  it('reports each end it had to clip', () => {
    const latex = `${'x'.repeat(40)}\\bad${'y'.repeat(40)}`;
    const excerpt = sourceExcerpt(latex, { index: 40, length: 4 }, 5);
    expect(excerpt.marked).toBe('\\bad');
    expect(excerpt.before).toBe('xxxxx');
    expect(excerpt.after).toBe('yyyyy');
    expect(excerpt.clippedStart).toBe(true);
    expect(excerpt.clippedEnd).toBe(true);
  });

  it('clamps a span that runs past the end of the source', () => {
    expect(sourceExcerpt('x', { index: 5, length: 9 })).toEqual({
      before: 'x',
      marked: '',
      after: '',
      clippedStart: false,
      clippedEnd: false,
    });
  });
});

describe('copying with delimiters', () => {
  it('wraps the body in the delimiters for its style', () => {
    expect(wrapMathLatex('\\frac{a}{b}')).toBe('\\[ \\frac{a}{b} \\]');
    expect(wrapMathLatex('\\frac{a}{b}', true)).toBe('\\( \\frac{a}{b} \\)');
  });

  it('survives a round trip through the paste unwrapper in either style', () => {
    const body = '\\int_0^1 f';
    expect(normalizePastedLatex(wrapMathLatex(body))).toBe(body);
    expect(normalizePastedLatex(wrapMathLatex(body, true))).toBe(body);
  });

  it('leaves an empty equation unwrapped', () => {
    expect(wrapMathLatex('   ')).toBe('');
  });
});

// Counting braces answers about a half-typed expression straight away, where
// MathJax only complains once the source has settled and a typeset has failed.
describe('finding an unbalanced brace before a typeset fails', () => {
  it('says nothing about source that balances', () => {
    expect(unbalancedBrace('\\frac{a}{b}')).toBeNull();
    expect(unbalancedBrace('')).toBeNull();
  });

  it('closes the group that was left open, keeping what was typed inside it', () => {
    const problem = unbalancedBrace('\\sqrt{x + 1');

    expect(problem).toMatchObject({
      kind: 'unclosed',
      span: { index: 5, length: 1 },
      fix: { value: '\\sqrt{x + 1}', caret: 12 },
    });
  });

  it('drops a closing brace that had nothing to close', () => {
    const problem = unbalancedBrace('x^2} + 1');

    expect(problem).toMatchObject({
      kind: 'extra',
      span: { index: 3, length: 1 },
      fix: { value: 'x^2 + 1', caret: 3 },
    });
  });

  it('points at the innermost group still open', () => {
    expect(unbalancedBrace('\\frac{a{b}')).toMatchObject({
      kind: 'unclosed',
      span: { index: 5, length: 1 },
    });
  });

  it('ignores escaped braces, which are glyphs rather than grouping', () => {
    expect(unbalancedBrace('\\{a\\}')).toBeNull();
  });

  // Repairing one brace has to leave a source the counter agrees with, or the
  // hint would reappear on the value its own fix produced.
  it('produces a source that balances', () => {
    for (const latex of ['\\sqrt{x + 1', 'x^2} + 1', '\\frac{a{b}']) {
      const problem = unbalancedBrace(latex);
      expect(problem).not.toBeNull();
      expect(unbalancedBrace(problem!.fix.value)).toBeNull();
    }
  });
});

describe('finding an unclosed \left', () => {
  it('says nothing about a pair that matches', () => {
    expect(unbalancedDelimiter(String.raw`\left( x \right)`)).toBeNull();
    expect(unbalancedDelimiter('(x)')).toBeNull();
  });

  it('closes it with the delimiter the opener asked for', () => {
    expect(unbalancedDelimiter(String.raw`\left[ x + 1`)).toMatchObject({
      span: { index: 0, length: 5 },
      action: 'Close it',
      fix: { value: String.raw`\left[ x + 1\right]` },
    });
  });

  it('falls back to the invisible delimiter for an opener it cannot name', () => {
    expect(unbalancedDelimiter(String.raw`\left\uparrow x`)?.fix.value).toBe(
      String.raw`\left\uparrow x\right.`,
    );
  });

  it('drops a \right that closes nothing, keeping its bracket', () => {
    expect(unbalancedDelimiter(String.raw`x \right) + 1`)).toMatchObject({
      span: { index: 2, length: 6 },
      action: 'Remove it',
      fix: { value: 'x ) + 1', caret: 2 },
    });
  });

  it('reads a line break as an escape rather than a \left', () => {
    // `\\left` is a row break followed by the letters "left", not a delimiter.
    expect(unbalancedDelimiter(String.raw`a \\left( b \right)`)).toMatchObject({
      action: 'Remove it',
    });
  });

  it('points at the innermost opener still waiting', () => {
    expect(
      unbalancedDelimiter(String.raw`\left( \left[ x \right]`),
    ).toMatchObject({ span: { index: 0, length: 5 } });
  });
});

describe('finding an environment that never ends', () => {
  it('says nothing about a matched pair', () => {
    expect(
      unclosedEnvironment(String.raw`\begin{aligned} x &= 1 \end{aligned}`),
    ).toBeNull();
  });

  it('closes the environment that was opened', () => {
    const problem = unclosedEnvironment(String.raw`\begin{cases} x & y`);

    expect(problem).toMatchObject({
      span: { index: 0, length: 13 },
      action: 'Close it',
    });
    expect(problem?.fix.value).toBe(
      String.raw`\begin{cases} x & y` + '\n' + String.raw`\end{cases}`,
    );
  });

  it('renames an \end whose environment disagrees with its \begin', () => {
    const problem = unclosedEnvironment(
      String.raw`\begin{aligned} x \end{align}`,
    );

    expect(problem).toMatchObject({ action: 'Fix it' });
    expect(problem?.message).toContain(String.raw`\begin{aligned}`);
    expect(problem?.fix.value).toBe(
      String.raw`\begin{aligned} x \end{aligned}`,
    );
  });

  it('drops an \end that closes nothing', () => {
    expect(unclosedEnvironment(String.raw`x \end{cases}`)).toMatchObject({
      action: 'Remove it',
      fix: { value: 'x ', caret: 2 },
    });
  });
});

describe('finding a math delimiter typed into math', () => {
  it('says nothing about an expression with none', () => {
    expect(strayDelimiter(String.raw`\frac{a}{b}`)).toBeNull();
  });

  it('points at the wrapper someone typed out of habit', () => {
    expect(strayDelimiter('$$x^2')).toMatchObject({
      span: { index: 0, length: 2 },
      action: 'Remove it',
      fix: { value: 'x^2', caret: 0 },
    });
    expect(strayDelimiter(String.raw`\[x^2`)).toMatchObject({
      span: { index: 0, length: 2 },
    });
  });

  it('leaves an escaped dollar alone, which is a currency sign', () => {
    expect(strayDelimiter(String.raw`\$5 + \$3`)).toBeNull();
  });

  it('is not fooled by a command whose name starts with a bracket letter', () => {
    expect(strayDelimiter(String.raw`\left[ x \right]`)).toBeNull();
  });
});

describe('choosing which fault to report', () => {
  it('reports the one that comes first in the source', () => {
    const problem = sourceProblem(String.raw`\left( \frac{a`);
    expect(problem?.span.index).toBe(0);
    expect(problem?.message).toContain(String.raw`\left`);
  });

  it('finds each kind on its own', () => {
    expect(sourceProblem(String.raw`\sqrt{x`)?.action).toBe('Close it');
    expect(sourceProblem('x $')?.action).toBe('Remove it');
    expect(sourceProblem(String.raw`\begin{cases} x`)?.action).toBe('Close it');
  });

  it('says nothing about source that reads cleanly', () => {
    expect(
      sourceProblem(
        String.raw`\begin{aligned} \left| x \right| &= 1 \end{aligned}`,
      ),
    ).toBeNull();
  });

  // Each repair has to leave a source the scan agrees with, or the hint would
  // reappear on the value its own button produced.
  it('produces a source with nothing left to report', () => {
    for (const latex of [
      String.raw`\left[ x + 1`,
      String.raw`x \right) + 1`,
      String.raw`\begin{cases} x & y`,
      String.raw`\begin{aligned} x \end{align}`,
      '$$x^2',
      String.raw`\sqrt{x`,
    ]) {
      const problem = sourceProblem(latex);
      expect(problem).not.toBeNull();
      expect(sourceProblem(problem!.fix.value)).toBeNull();
    }
  });
});

describe('locating a \left failure MathJax reported', () => {
  it('points at the opener it never closed', () => {
    expect(
      locateLatexError(String.raw`\left( x`, 'Missing \\right. inserted'),
    ).toEqual({ index: 0, length: 5 });
  });
});
