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

  it('caches invalid LaTeX as a recoverable render error', async () => {
    const latex = String.raw`\frac{a}`;
    const render = await typesetEquation(latex);

    expect(render).toMatchObject({
      error: expect.stringContaining('Missing argument'),
    });
    expect(getEquationRender(latex)).toBe(render);
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
