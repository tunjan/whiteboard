import { describe, expect, it } from 'vitest';
import {
  EDGE_SCROLL_DELAY_MS,
  EDGE_SCROLL_DISTANCE,
  EDGE_SCROLL_EASE_MS,
  edgeProximity,
  edgeProximityVector,
  edgeScrollDelta,
  edgeScrollRamp,
} from './edge-scroll';

describe('edgeProximity', () => {
  it('is zero away from both edges', () => {
    expect(edgeProximity(500, 1000)).toBe(0);
  });

  it('ramps to 1 at the low edge and -1 at the high edge', () => {
    expect(edgeProximity(0, 1000)).toBe(1);
    expect(edgeProximity(EDGE_SCROLL_DISTANCE / 2, 1000)).toBeCloseTo(0.5);
    expect(edgeProximity(1000, 1000)).toBe(-1);
    expect(edgeProximity(1000 - EDGE_SCROLL_DISTANCE / 2, 1000)).toBeCloseTo(
      -0.5,
    );
  });

  it('saturates past the edge rather than growing without bound', () => {
    expect(edgeProximity(-400, 1000)).toBe(1);
    expect(edgeProximity(1400, 1000)).toBe(-1);
  });
});

describe('edgeScrollRamp', () => {
  it('holds still through the delay', () => {
    expect(edgeScrollRamp(0)).toBe(0);
    expect(edgeScrollRamp(EDGE_SCROLL_DELAY_MS - 1)).toBe(0);
  });

  it('eases in cubically and saturates', () => {
    expect(edgeScrollRamp(EDGE_SCROLL_DELAY_MS)).toBe(0);
    expect(
      edgeScrollRamp(EDGE_SCROLL_DELAY_MS + EDGE_SCROLL_EASE_MS / 2),
    ).toBeCloseTo(0.125);
    expect(edgeScrollRamp(EDGE_SCROLL_DELAY_MS + EDGE_SCROLL_EASE_MS)).toBe(1);
    expect(edgeScrollRamp(100_000)).toBe(1);
  });
});

describe('edgeScrollDelta', () => {
  const held = EDGE_SCROLL_DELAY_MS + EDGE_SCROLL_EASE_MS;

  it('does not move during the delay', () => {
    const p = edgeProximityVector({ x: 0, y: 500 }, 1200, 1200);
    expect(edgeScrollDelta(p, 1200, 1200, 100, 16)).toEqual({ x: 0, y: 0 });
  });

  it('moves the camera toward the edge the pointer is held against', () => {
    const p = edgeProximityVector({ x: 0, y: 500 }, 1200, 1200);
    const delta = edgeScrollDelta(p, 1200, 1200, held, 16);
    // Pointer at the left edge: the camera moves left to bring content in.
    expect(delta.x).toBeLessThan(0);
    expect(delta.y).toBeCloseTo(0);

    const right = edgeProximityVector({ x: 1200, y: 500 }, 1200, 1200);
    expect(edgeScrollDelta(right, 1200, 1200, held, 16).x).toBeGreaterThan(0);
  });

  it('slows down on a small viewport', () => {
    const big = edgeProximityVector({ x: 0, y: 600 }, 1200, 1200);
    const small = edgeProximityVector({ x: 0, y: 300 }, 600, 600);
    expect(Math.abs(edgeScrollDelta(small, 600, 600, held, 16).x)).toBeLessThan(
      Math.abs(edgeScrollDelta(big, 1200, 1200, held, 16).x),
    );
  });

  it('covers the same ground per unit time at any frame rate', () => {
    const p = edgeProximityVector({ x: 0, y: 600 }, 1200, 1200);
    const one = edgeScrollDelta(p, 1200, 1200, held, 16).x;
    const two = edgeScrollDelta(p, 1200, 1200, held, 8).x;
    expect(one).toBeCloseTo(two * 2);
  });
});
