import { describe, expect, it } from 'vitest';
import type { EquationShape, Shape } from '@whiteboard/shared';
import { typesetEquation } from './equation-render';
import {
  countInvalidEquations,
  exportImageUrls,
  isExportable,
  rasterSize,
} from './export-png';

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

  it('counts invalid non-empty equations for export preflight', async () => {
    const invalid = equation(String.raw`\notacommand{x}`);
    const valid = { ...equation('x+1'), id: 'valid' };
    const empty = { ...equation(''), id: 'empty' };
    await Promise.all([
      typesetEquation(invalid.props.latex),
      typesetEquation(valid.props.latex),
    ]);

    expect(countInvalidEquations([invalid, valid, empty])).toBe(1);
    expect(
      countInvalidEquations(
        [invalid, valid, empty],
        new Set([valid.id]),
      ),
    ).toBe(0);
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

describe('raster sizing', () => {
  it('keeps a sprawling scene inside the canvas cap', () => {
    // 200k world units wide: the cap asks for 0.041, which the 0.1 floor used
    // to override — producing a 20017px canvas. Over ~268 megapixels Chrome
    // rasterizes fully transparent without throwing, so the export and the
    // clipboard copy both came back blank.
    const { outW, outH } = rasterSize(200166, 166, 1);
    expect(outW).toBeLessThanOrEqual(8192);
    expect(outH).toBeLessThanOrEqual(8192);
  });

  it('caps both axes of a scene that sprawls in each', () => {
    const { outW, outH } = rasterSize(200000, 200000, 4);
    expect(outW).toBeLessThanOrEqual(8192);
    expect(outH).toBeLessThanOrEqual(8192);
    expect(outW * outH).toBeLessThan(268_000_000);
  });

  it('honours the requested scale when it fits', () => {
    expect(rasterSize(400, 300, 2)).toMatchObject({
      scale: 2,
      outW: 800,
      outH: 600,
    });
  });

  it('never returns a zero-pixel dimension', () => {
    const { outW, outH } = rasterSize(10000, 0.01, 1);
    expect(outW).toBeGreaterThan(0);
    expect(outH).toBeGreaterThan(0);
  });
});

describe('export image inlining', () => {
  const stored = `/api/blobs/${'a1'.repeat(32)}.png`;

  it('finds stored blob urls', () => {
    expect(exportImageUrls(`<image href="${stored}"/>`)).toEqual([stored]);
  });

  // The regression: `imageHref` serves an object URL for every image this
  // client placed, so a just-pasted image exported as an empty outline.
  it('finds the object url of a locally placed image', () => {
    const local = 'blob:http://localhost:5173/9a4f-1b2c';

    expect(exportImageUrls(`<image href="${local}"/>`)).toEqual([local]);
  });

  it('deduplicates and keeps both forms', () => {
    const local = 'blob:http://localhost:5173/9a4f-1b2c';
    const svg = `<image href="${stored}"/><image href="${local}"/><image href="${local}"/>`;

    expect(exportImageUrls(svg)).toEqual([stored, local]);
  });

  it('leaves an already-inlined image alone', () => {
    expect(exportImageUrls('<image href="data:image/png;base64,AAAA"/>')).toEqual(
      [],
    );
  });
});
