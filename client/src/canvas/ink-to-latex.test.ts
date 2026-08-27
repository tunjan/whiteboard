import { describe, expect, it } from 'vitest';
import { placement } from './ink-to-latex';

// Real MathJax output at the measuring size (fontSize 16), captured from
// `x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}`: width 166.12, height 42.328. A
// two-level fraction like this is what makes the clamp load-bearing — MathJax
// sets it far more tightly than a hand ever does.
const FRACTION_RENDER = { width: 166.12, height: 42.328 };
const boundsOfHeight = (height: number) => ({
  minX: 0,
  minY: 0,
  maxX: 100,
  maxY: height,
});

describe('placement', () => {
  it('matches the ink height when that lands inside the manual size range', () => {
    // (120 / 42.328) * 16 ≈ 45.4 before clamping — pick a height that lands
    // inside [16, 40] instead, so this case exercises the unclamped path.
    const bounds = boundsOfHeight(60); // -> fontSize ≈ 22.7
    const result = placement(FRACTION_RENDER, bounds);
    expect(result.fontSize).toBeGreaterThan(16);
    expect(result.fontSize).toBeLessThan(40);
    expect(result.h).toBeCloseTo(60, 0);
  });

  // An entirely ordinary two-line handwritten fraction — well short of a full
  // page of working — already asks for a fontSize past the panel's own
  // largest manual preset. This is the case that used to render oversized.
  it('caps an ordinary two-line fraction at the largest manual preset', () => {
    const bounds = boundsOfHeight(180); // -> fontSize ≈ 68 unclamped
    const result = placement(FRACTION_RENDER, bounds);
    expect(result.fontSize).toBe(40);
  });

  it('floors a tiny scrawl at the smallest manual preset', () => {
    const bounds = boundsOfHeight(10); // -> fontSize ≈ 3.8 unclamped
    const result = placement(FRACTION_RENDER, bounds);
    expect(result.fontSize).toBe(16);
  });

  it('centers the placed box on the ink bounds', () => {
    const bounds = { minX: 100, minY: 200, maxX: 300, maxY: 260 };
    const result = placement(FRACTION_RENDER, bounds);
    expect(result.x + result.w / 2).toBeCloseTo(200, 5);
    expect(result.y + result.h / 2).toBeCloseTo(230, 5);
  });
});
