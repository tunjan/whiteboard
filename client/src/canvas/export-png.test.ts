import { describe, expect, it } from 'vitest';
import type { EquationShape, Shape } from '@whiteboard/shared';
import { typesetEquation } from './equation-render';
import { isExportable } from './export-png';

function equation(latex: string): EquationShape {
  return {
    id: 'eq',
    type: 'equation',
    x: 0,
    y: 0,
    rotation: 0,
    index: 'a0',
    props: { latex, color: '#111', fontSize: 28, w: 120, h: 48 },
  };
}

describe('export placeholder filtering', () => {
  it('exports an equation that typesets', async () => {
    const latex = String.raw`x^2+1`;
    await typesetEquation(latex);

    expect(isExportable(equation(latex))).toBe(true);
  });

  it('drops an equation with no source', () => {
    expect(isExportable(equation(''))).toBe(false);
    expect(isExportable(equation('   '))).toBe(false);
  });

  it('drops an equation whose source does not typeset', async () => {
    const latex = String.raw`\frac{a}`;
    await typesetEquation(latex);

    expect(isExportable(equation(latex))).toBe(false);
  });

  it('leaves every other shape type alone', () => {
    const rect = {
      id: 'r',
      type: 'rectangle',
      x: 0,
      y: 0,
      rotation: 0,
      index: 'a0',
      props: {
        w: 10,
        h: 10,
        color: '#111',
        fillStyle: 'none',
        dash: 'solid',
        size: 2,
      },
    } as Shape;

    expect(isExportable(rect)).toBe(true);
  });
});
