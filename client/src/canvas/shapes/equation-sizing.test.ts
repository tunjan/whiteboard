import { describe, expect, it } from 'vitest';
import {
  EQUATION_DEFAULT_FONT_SIZE,
  equationBoxSize,
  equationFontSizeForHeight,
} from './equation';

// MathJax measures every render at 16px, so both helpers are conversions
// between that and the shape's own `fontSize`.

describe('equationBoxSize', () => {
  it('returns the render unchanged at the measuring size', () => {
    expect(equationBoxSize({ width: 100, height: 40 }, 16)).toEqual({
      w: 100,
      h: 40,
    });
  });

  it('scales both axes by fontSize', () => {
    expect(equationBoxSize({ width: 100, height: 40 }, 32)).toEqual({
      w: 200,
      h: 80,
    });
  });
});

describe('equationFontSizeForHeight', () => {
  it('finds the size at which a render stands that tall', () => {
    const fontSize = equationFontSizeForHeight({ height: 40 }, 80);
    expect(fontSize).toBe(32);
    expect(equationBoxSize({ width: 100, height: 40 }, fontSize).h).toBe(80);
  });

  // A render with no height would otherwise divide by zero and put a NaN
  // fontSize (and so a NaN box) into the shared document.
  it('falls back to the default when the render has no height', () => {
    expect(equationFontSizeForHeight({ height: 0 }, 80)).toBe(
      EQUATION_DEFAULT_FONT_SIZE,
    );
  });
});
