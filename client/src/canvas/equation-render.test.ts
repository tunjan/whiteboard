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
});
