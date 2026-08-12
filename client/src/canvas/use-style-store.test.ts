import { describe, expect, it } from 'vitest';
import { PALETTES } from './use-style-store';

describe('drawing palettes', () => {
  it('provides 12 colors per palette in both themes', () => {
    for (const palette of PALETTES) {
      expect(palette.light, `${palette.name} light palette`).toHaveLength(12);
      expect(palette.dark, `${palette.name} dark palette`).toHaveLength(12);
    }
  });

  // Flipping the theme remaps the pen by slot index, so slot N has to be the
  // same color in both themes of a palette or the pen silently changes hue.
  it('names each slot identically in both themes of a palette', () => {
    for (const palette of PALETTES) {
      expect(
        palette.dark.map((c) => c.name),
        `${palette.name} slot names`,
      ).toEqual(palette.light.map((c) => c.name));
    }
  });

  // Classic (forest) and Grayscale are themed sets with their own slots; the
  // rest share one evenly spaced hue wheel.
  it('shares one hue wheel across the untinted palettes', () => {
    const wheel = PALETTES.find((p) => p.id === 'vibrant')!.light.map(
      (c) => c.name,
    );
    for (const palette of PALETTES) {
      if (palette.id === 'classic' || palette.id === 'grayscale') continue;
      expect(
        palette.light.map((c) => c.name),
        `${palette.name} slot names`,
      ).toEqual(wheel);
    }
  });

  // Mixed color formats made slot-to-slot comparison impossible and had to be
  // parsed by `color-mix` in the swatch borders and by the PNG export's SVG.
  it('writes every swatch as sRGB hex', () => {
    for (const palette of PALETTES) {
      for (const theme of ['light', 'dark'] as const) {
        for (const { name, value } of palette[theme]) {
          expect(value, `${palette.name} ${theme} ${name}`).toMatch(
            /^#[0-9a-f]{6}$/,
          );
        }
      }
    }
  });

  it('has no duplicate values within a palette', () => {
    for (const palette of PALETTES) {
      for (const theme of ['light', 'dark'] as const) {
        const values = palette[theme].map((c) => c.value);
        expect(new Set(values).size, `${palette.name} ${theme}`).toBe(
          values.length,
        );
      }
    }
  });
});
