import { describe, expect, it } from 'vitest';
import { withAlpha } from './svg-raster';

describe('svg-raster withAlpha', () => {
  it('handles 6-digit hex colors', () => {
    expect(withAlpha('#000000', 0.13)).toBe('rgba(0, 0, 0, 0.13)');
    expect(withAlpha('#ffffff', 0.5)).toBe('rgba(255, 255, 255, 0.5)');
    expect(withAlpha('#1a2b3c', 0.8)).toBe('rgba(26, 43, 60, 0.8)');
  });

  it('handles named colors', () => {
    expect(withAlpha('black', 0.13)).toBe('rgba(0, 0, 0, 0.13)');
    expect(withAlpha('Black', 0.5)).toBe('rgba(0, 0, 0, 0.5)');
    expect(withAlpha('white', 0.2)).toBe('rgba(255, 255, 255, 0.2)');
  });

  it('handles 3-digit shorthand hex colors', () => {
    expect(withAlpha('#000', 0.13)).toBe('rgba(0, 0, 0, 0.13)');
    expect(withAlpha('#fff', 0.5)).toBe('rgba(255, 255, 255, 0.5)');
    expect(withAlpha('#f00', 0.75)).toBe('rgba(255, 0, 0, 0.75)');
  });

  it('handles rgb and rgba strings', () => {
    expect(withAlpha('rgb(0, 0, 0)', 0.15)).toBe('rgba(0, 0, 0, 0.15)');
    expect(withAlpha('rgba(0, 0, 0, 0.5)', 0.5)).toBe('rgba(0, 0, 0, 0.25)');
  });

  it('returns color as-is when alpha is 1 or greater', () => {
    expect(withAlpha('#000000', 1)).toBe('#000000');
    expect(withAlpha('black', 1)).toBe('black');
  });
});
