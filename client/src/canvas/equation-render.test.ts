import { describe, expect, it } from 'vitest';
import {
  getEquationRender,
  typesetEquation,
} from './equation-render';

describe('equation SVG rendering', () => {
  it('caches a self-contained path render with measured dimensions', async () => {
    const latex = String.raw`\frac{a}{b}+\sqrt{x^2}`;
    const render = await typesetEquation(latex);

    expect('error' in render).toBe(false);
    if ('error' in render) return;
    expect(render.width).toBeGreaterThan(0);
    expect(render.height).toBeGreaterThan(0);
    expect(render.svg).toContain('<path');
    expect(render.svg).not.toContain('<use');
    const rootTag = render.svg.slice(0, render.svg.indexOf('>'));
    expect(rootTag).not.toMatch(/\swidth=/);
    expect(rootTag).not.toMatch(/\sheight=/);
    expect(getEquationRender(latex)).toBe(render);
  });

  // The same source in text style: limits beside the sum rather than above it,
  // and a smaller fraction — a different render, not a different expression.
  it('typesets one expression differently in each style', async () => {
    const latex = String.raw`\sum_{i=1}^{n} \frac{1}{i}`;
    const block = await typesetEquation(latex);
    const inline = await typesetEquation(latex, true);

    if ('error' in block || 'error' in inline)
      throw new Error('did not render');
    expect(inline.height).toBeLessThan(block.height);
    expect(inline.width).toBeGreaterThan(block.width);
    expect(inline.svg).not.toBe(block.svg);
  });

  it('caches the two styles apart', async () => {
    const latex = String.raw`\int_0^1 x^2`;
    const inline = await typesetEquation(latex, true);

    // Nothing has asked for the display render yet, so the shared source must
    // not hand back the inline one.
    expect(getEquationRender(latex)).toBeUndefined();
    expect(getEquationRender(latex, true)).toBe(inline);

    const block = await typesetEquation(latex);
    expect(block).not.toBe(inline);
    expect(getEquationRender(latex)).toBe(block);
    expect(getEquationRender(latex, true)).toBe(inline);
  });

  it('caches invalid LaTeX as a recoverable render error', async () => {
    const latex = String.raw`\frac{a}`;
    const render = await typesetEquation(latex);

    expect(render).toMatchObject({
      error: expect.stringContaining('Missing argument'),
    });
    expect(getEquationRender(latex)).toBe(render);
  });

  it('turns MathJax inline errors into recoverable render errors', async () => {
    const latex = String.raw`\notacommand{x}`;
    const render = await typesetEquation(latex);

    expect(render).toMatchObject({
      error: expect.stringMatching(/undefined control sequence/i),
    });
    expect(getEquationRender(latex)).toBe(render);
  });

  // A render is injected as markup with `dangerouslySetInnerHTML`, and its
  // LaTeX can come from any collaborator on the board. MathJax's `html` package
  // used to pass an author's string straight into an attribute of the result.
  describe('untrusted source cannot reach the DOM as live markup', () => {
    it('does not emit a link for \\href', async () => {
      const render = await typesetEquation(
        String.raw`\href{javascript:alert(1)}{x}`,
      );

      // The command is gone with the package, so this is a plain TeX error.
      expect(render).toMatchObject({
        error: expect.stringMatching(/undefined control sequence/i),
      });
    });

    it.each([
      ['\\style', String.raw`\style{position:fixed;top:0;left:0}{x}`],
      ['\\cssId', String.raw`\cssId{equation-error-other-shape}{x}`],
    ])('does not emit an attribute for %s', async (_name, latex) => {
      const render = await typesetEquation(latex);

      expect(render).toMatchObject({
        error: expect.stringMatching(/undefined control sequence/i),
      });
    });

    it('strips executable attributes a package could still emit', async () => {
      const render = await typesetEquation(String.raw`\frac{a}{b}`);

      expect('error' in render).toBe(false);
      if ('error' in render) return;
      // `id` and `style` are unused by a self-contained path render, so
      // removing them costs nothing and closes DOM clobbering and CSS
      // injection along with the `javascript:` link.
      expect(render.svg).not.toMatch(/\s(?:xlink:)?href=/i);
      expect(render.svg).not.toMatch(/\sstyle=/i);
      expect(render.svg).not.toMatch(/\sid=/i);
      expect(render.svg).not.toMatch(/\son[a-z]+=/i);
    });

    it('still renders the math the removed package was not needed for', async () => {
      const render = await typesetEquation(
        String.raw`\begin{align} a &= b \\ c &= d \end{align}`,
      );

      expect('error' in render).toBe(false);
      if ('error' in render) return;
      expect(render.svg).toContain('<path');
      expect(render.height).toBeGreaterThan(0);
    });
  });

  // A transcription of a printed page carries prose — step labels, "where",
  // units — and `INK_SYSTEM_PROMPT` instructs the model to wrap it in \text
  // precisely because everything here renders in math mode. That makes these
  // commands part of the contract: the package filter in `equation-convert`
  // must keep supplying them, or every transcription with a word in it fails.
  it.each([
    String.raw`\text{where } x = 1`,
    String.raw`\textbf{Step 2} \quad a^2 + b^2 = c^2`,
    String.raw`v = 3\,\text{m/s}`,
    String.raw`\begin{aligned} \textbf{Given} &: x = 2 \\ \text{then} &: y = 3 \end{aligned}`,
  ])('typesets prose wrapped in \\text / \\textbf: %s', async (latex) => {
    const render = await typesetEquation(latex);
    expect('error' in render ? render.error : null).toBeNull();
  });

  // The panel typesets every keystroke, so an editing session used to leave one
  // retained SVG per abandoned prefix, forever.
  it('bounds the cache and evicts least-recently-read expressions', async () => {
    const onScreen = String.raw`\alpha_{onscreen}`;
    const first = await typesetEquation(onScreen);

    // Stand in for typing: many one-shot expressions, none read again. Reading
    // the on-screen one each round is what a mounted shape's render does.
    for (let i = 0; i < 600; i++) {
      await typesetEquation(`x_{${i}}+1`);
      expect(getEquationRender(onScreen)).toBe(first);
    }

    // The expression still being read survived; the abandoned prefixes did not.
    expect(getEquationRender(onScreen)).toBe(first);
    expect(getEquationRender('x_{0}+1')).toBeUndefined();
    // ...and a miss still re-typesets to an equivalent render.
    const again = await typesetEquation('x_{0}+1');
    expect('error' in again).toBe(false);
  });
});
