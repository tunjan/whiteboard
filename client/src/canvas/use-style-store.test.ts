import { describe, expect, it } from 'vitest';
import { PALETTE, SIZE_OPTIONS } from './use-style-store';

describe('drawing palette', () => {
  // The swatch grid is four columns wide and shows one theme at a time.
  it('provides 12 colors in both themes', () => {
    expect(PALETTE.light, 'light palette').toHaveLength(12);
    expect(PALETTE.dark, 'dark palette').toHaveLength(12);
  });

  // Flipping the theme remaps the pen by slot index, so slot N has to be the
  // same color in both themes or the pen silently changes hue. Slot 0 is the
  // ink swatch and inverts on purpose: black on the light canvas, white on the
  // dark one.
  it('names each slot identically in both themes apart from the ink slot', () => {
    expect(PALETTE.light[0]?.name).toBe('Black');
    expect(PALETTE.dark[0]?.name).toBe('White');
    expect(PALETTE.dark.slice(1).map((c) => c.name)).toEqual(
      PALETTE.light.slice(1).map((c) => c.name),
    );
  });

  // Mixed color formats made slot-to-slot comparison impossible and had to be
  // parsed by `color-mix` in the swatch borders and by the PNG export's SVG.
  it('writes every swatch as sRGB hex', () => {
    for (const theme of ['light', 'dark'] as const) {
      for (const { name, value } of PALETTE[theme]) {
        expect(value, `${theme} ${name}`).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it('has no duplicate values within a theme', () => {
    for (const theme of ['light', 'dark'] as const) {
      const values = PALETTE[theme].map((c) => c.value);
      expect(new Set(values).size, theme).toBe(values.length);
    }
  });
});

describe('stroke size scale', () => {
  it('uses the 2 / 3.5 / 5 / 10 px system matrix', () => {
    expect(SIZE_OPTIONS).toEqual([
      { name: 'S', value: 2 },
      { name: 'M', value: 3.5 },
      { name: 'L', value: 5 },
      { name: 'XL', value: 10 },
    ]);
  });
});
