import { describe, expect, it } from 'vitest';
import { textOnColor } from './identity';

describe('textOnColor', () => {
  it('uses white on the dark palette colours', () => {
    for (const color of ['#2f6df6', '#8b5cf6', '#d6409f', '#e5484d', '#1ea672']) {
      expect(textOnColor(color)).toBe('#fff');
    }
  });

  it('uses black on the light palette colours', () => {
    for (const color of ['#f5a524', '#14b8a6', '#f97316', '#0ea5e9']) {
      expect(textOnColor(color)).toBe('#101010');
    }
  });

  it('accepts shorthand hex', () => {
    expect(textOnColor('#fff')).toBe('#101010');
    expect(textOnColor('#000')).toBe('#fff');
  });

  it('falls back to white for unparseable colours', () => {
    expect(textOnColor('rebeccapurple')).toBe('#fff');
  });
});
