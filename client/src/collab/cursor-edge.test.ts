import { describe, expect, it } from 'vitest';
import { cursorEdgeIndicator } from './cursor-edge';

const viewport = { width: 800, height: 600 };

describe('cursorEdgeIndicator', () => {
  it('does not create an indicator for a cursor inside the viewport', () => {
    expect(cursorEdgeIndicator({ x: 400, y: 300 }, viewport, 28)).toBeNull();
    expect(cursorEdgeIndicator({ x: 0, y: 600 }, viewport, 28)).toBeNull();
  });

  it('places cardinal directions on the matching inset edge', () => {
    expect(cursorEdgeIndicator({ x: 1200, y: 300 }, viewport, 28)).toEqual({
      position: { x: 772, y: 300 },
      rotation: 90,
    });
    expect(cursorEdgeIndicator({ x: 400, y: -300 }, viewport, 28)).toEqual({
      position: { x: 400, y: 28 },
      rotation: 0,
    });
  });

  it('preserves the cursor direction for diagonal positions', () => {
    const indicator = cursorEdgeIndicator(
      { x: -400, y: 1200 },
      viewport,
      28,
    );

    expect(indicator?.position.x).toBeCloseTo(158.22, 2);
    expect(indicator?.position.y).toBe(572);
    expect(indicator?.rotation).toBeCloseTo(221.63, 2);
  });

  it('does not create an indicator before the viewport is measured', () => {
    expect(
      cursorEdgeIndicator({ x: 100, y: 100 }, { width: 0, height: 0 }, 28),
    ).toBeNull();
  });
});
