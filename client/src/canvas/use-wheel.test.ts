import { describe, expect, it } from 'vitest';
import { normalizeWheelDelta } from './use-wheel';

describe('normalizeWheelDelta', () => {
  it('passes pixel-mode deltas through unchanged', () => {
    expect(normalizeWheelDelta({ deltaX: -12, deltaY: 40, deltaMode: 0 })).toEqual({
      x: -12,
      y: 40,
    });
  });

  it('scales line-mode deltas to pixels', () => {
    expect(normalizeWheelDelta({ deltaX: 1, deltaY: -3, deltaMode: 1 })).toEqual({
      x: 16,
      y: -48,
    });
  });

  it('scales page-mode deltas to pixels', () => {
    expect(normalizeWheelDelta({ deltaX: 0, deltaY: 1, deltaMode: 2 })).toEqual({
      x: 0,
      y: 800,
    });
  });
});
