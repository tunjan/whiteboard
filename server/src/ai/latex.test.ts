import { describe, expect, it } from 'vitest';
import { LATEX_UNREADABLE, MAX_LATEX_CHARS } from '@whiteboard/shared';
import { extractGraphExpressions, extractLatex } from './latex';

describe('extractLatex', () => {
  it('passes a bare body through', () => {
    expect(extractLatex('x^2 + 1')).toEqual({ latex: 'x^2 + 1' });
  });

  it('trims surrounding whitespace and newlines', () => {
    expect(extractLatex('\n  \\frac{a}{b}\n')).toEqual({ latex: '\\frac{a}{b}' });
  });

  it.each([
    ['$$x^2$$', 'x^2'],
    ['$x^2$', 'x^2'],
    ['\\[x^2\\]', 'x^2'],
    ['\\(x^2\\)', 'x^2'],
  ])('strips %s', (raw, expected) => {
    expect(extractLatex(raw)).toEqual({ latex: expected });
  });

  it('strips a fenced block with a language tag', () => {
    expect(extractLatex('```latex\nx^2 + 1\n```')).toEqual({ latex: 'x^2 + 1' });
  });

  it('strips a fenced block with no language tag', () => {
    expect(extractLatex('```\nx^2\n```')).toEqual({ latex: 'x^2' });
  });

  it('strips a fence and the delimiters inside it', () => {
    expect(extractLatex('```latex\n$$\\frac{a}{b}$$\n```')).toEqual({
      latex: '\\frac{a}{b}',
    });
  });

  it('unwraps a display environment the shape already provides', () => {
    expect(extractLatex('\\begin{equation}x^2\\end{equation}')).toEqual({
      latex: 'x^2',
    });
    expect(extractLatex('\\begin{equation*}x^2\\end{equation*}')).toEqual({
      latex: 'x^2',
    });
  });

  it('keeps structural environments intact', () => {
    const aligned = '\\begin{aligned}a &= b \\\\ c &= d\\end{aligned}';
    expect(extractLatex(aligned)).toEqual({ latex: aligned });
    const cases = '\\begin{cases}1 & x > 0 \\\\ 0 & x \\le 0\\end{cases}';
    expect(extractLatex(cases)).toEqual({ latex: cases });
  });

  // A lone `$` is a valid TeX token, so the pair-stripping must not eat it.
  it('leaves a single dollar sign alone', () => {
    expect(extractLatex('$')).toEqual({ latex: '$' });
  });

  it('does not strip delimiters that only appear inside the body', () => {
    expect(extractLatex('a $ b $ c')).toEqual({ latex: 'a $ b $ c' });
  });

  it('reports the refusal sentinel, fenced or not', () => {
    expect(extractLatex(LATEX_UNREADABLE)).toEqual({ reason: 'unreadable' });
    expect(extractLatex(`\`\`\`\n${LATEX_UNREADABLE}\n\`\`\``)).toEqual({
      reason: 'unreadable',
    });
  });

  it('reports an empty reply', () => {
    expect(extractLatex('   ')).toEqual({ reason: 'empty' });
    expect(extractLatex('$$\n$$')).toEqual({ reason: 'empty' });
    expect(extractLatex('```latex\n\n```')).toEqual({ reason: 'empty' });
  });

  it('reports a runaway reply', () => {
    expect(extractLatex('x'.repeat(MAX_LATEX_CHARS + 1))).toEqual({
      reason: 'too-long',
    });
  });
});

describe('extractGraphExpressions', () => {
  it('splits rows, drops blanks, peels fences and stray $', () => {
    expect(
      extractGraphExpressions('```\ny=x^2\n\n$x^2+y^2=9$\n(1,2)\n```'),
    ).toEqual({ expressions: ['y=x^2', 'x^2+y^2=9', '(1,2)'] });
  });

  it('reports the refusal sentinel, fenced or not', () => {
    expect(extractGraphExpressions(LATEX_UNREADABLE)).toEqual({ reason: 'unreadable' });
    expect(extractGraphExpressions(`\`\`\`\n${LATEX_UNREADABLE}\n\`\`\``)).toEqual({
      reason: 'unreadable',
    });
  });

  it('rejects empty and runaway replies', () => {
    expect(extractGraphExpressions('  ')).toEqual({ reason: 'empty' });
    expect(extractGraphExpressions('y=x\n'.repeat(11))).toEqual({ reason: 'too-long' });
  });
});
