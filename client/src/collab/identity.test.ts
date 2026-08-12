import { describe, expect, it } from 'vitest';
import { textOnColor } from './identity';

describe('textOnColor', () => {
  it('uses white only where it clears 4.5:1 (AA for text under 18px)', () => {
    for (const color of ['#2f6df6']) {
      expect(textOnColor(color)).toBe('#fff');
    }
  });

  it('uses black once white contrast drops below 4.5:1', () => {
    for (const color of [
      '#8b5cf6',
      '#d6409f',
      '#e5484d',
      '#1ea672',
      '#f5a524',
      '#14b8a6',
      '#f97316',
      '#0ea5e9',
    ]) {
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
