import { describe, expect, it } from 'vitest';
import { nextToolbarIndex } from './use-roving-toolbar';

describe('toolbar keyboard navigation', () => {
  it('moves and wraps in both directions', () => {
    expect(nextToolbarIndex(0, 4, 'ArrowRight')).toBe(1);
    expect(nextToolbarIndex(3, 4, 'ArrowRight')).toBe(0);
    expect(nextToolbarIndex(0, 4, 'ArrowLeft')).toBe(3);
    expect(nextToolbarIndex(2, 4, 'ArrowLeft')).toBe(1);
  });

  it('moves directly to the first and last controls', () => {
    expect(nextToolbarIndex(2, 5, 'Home')).toBe(0);
    expect(nextToolbarIndex(2, 5, 'End')).toBe(4);
    expect(nextToolbarIndex(0, 0, 'Home')).toBe(-1);
  });
});
