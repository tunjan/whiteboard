import { describe, expect, it } from 'vitest';
import {
  DOUBLE_TAP_MS,
  DOUBLE_TAP_SLOP,
  isDoubleTap,
  oneFingerZoomFactor,
} from './one-finger-zoom';

describe('oneFingerZoomFactor', () => {
  it('is neutral at the origin', () => {
    expect(oneFingerZoomFactor(0)).toBe(1);
  });

  it('doubles on a 200px drag down and halves on the same drag up', () => {
    expect(oneFingerZoomFactor(200)).toBeCloseTo(2);
    expect(oneFingerZoomFactor(-200)).toBeCloseTo(0.5);
  });
});

describe('isDoubleTap', () => {
  const first = { x: 100, y: 100, t: 1000 };

  it('rejects a first tap', () => {
    expect(isDoubleTap(null, { x: 100, y: 100 }, 1000)).toBe(false);
  });

  it('pairs a prompt tap nearby', () => {
    expect(isDoubleTap(first, { x: 105, y: 95 }, 1100)).toBe(true);
  });

  it('rejects one that is too late or too far', () => {
    expect(
      isDoubleTap(first, { x: 100, y: 100 }, 1000 + DOUBLE_TAP_MS + 1),
    ).toBe(false);
    expect(
      isDoubleTap(first, { x: 100 + DOUBLE_TAP_SLOP + 1, y: 100 }, 1100),
    ).toBe(false);
  });
});
