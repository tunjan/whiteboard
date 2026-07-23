import { describe, expect, it } from 'vitest';
import { PALETTES } from './use-style-store';

describe('drawing palettes', () => {
  it('provides 12 colors per palette in both themes', () => {
    for (const palette of PALETTES) {
      expect(palette.light, `${palette.name} light palette`).toHaveLength(12);
      expect(palette.dark, `${palette.name} dark palette`).toHaveLength(12);
    }
  });
});
