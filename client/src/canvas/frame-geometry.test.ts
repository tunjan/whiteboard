import { describe, expect, it } from 'vitest';
import type { FrameShape } from '@whiteboard/shared';
import {
  FRAME_HEADING_HEIGHT_SCREEN,
  frameContainsPoint,
  frameHeadingLayout,
  frameHeadingSide,
  frameOverlapsBounds,
} from './frame-geometry';

function frame(overrides: Partial<FrameShape> = {}): FrameShape {
  return {
    id: 'frame',
    type: 'frame',
    x: 10,
    y: 20,
    rotation: 0,
    index: 'a0',
    props: { w: 200, h: 120, name: 'A useful frame', color: '#334155' },
    ...overrides,
  };
}

describe('frame heading geometry', () => {
  it('tracks the visually upper edge through each right-angle rotation', () => {
    expect(frameHeadingSide(0)).toBe(0);
    expect(frameHeadingSide(Math.PI / 2)).toBe(1);
    expect(frameHeadingSide(Math.PI)).toBe(2);
    expect(frameHeadingSide((Math.PI * 3) / 2)).toBe(3);
  });

  it('keeps the composed title orientation upright at right angles', () => {
    for (const rotation of [0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2]) {
      const layout = frameHeadingLayout(frame({ rotation }), 1);
      expect(Math.abs(layout.pageRotation)).toBeLessThan(1e-9);
    }
  });

  it('keeps title height constant in screen pixels across zoom levels', () => {
    for (const zoom of [0.1, 0.5, 1, 4, 8]) {
      const layout = frameHeadingLayout(frame(), zoom);
      expect(layout.height * zoom).toBeCloseTo(FRAME_HEADING_HEIGHT_SCREEN);
    }
  });
});

describe('frame clip geometry', () => {
  it('contains page points through the frame rotation', () => {
    const rotated = frame({ rotation: Math.PI / 2 });
    expect(frameContainsPoint(rotated, { x: 110, y: 80 })).toBe(true);
    expect(frameContainsPoint(rotated, { x: 10, y: 20 })).toBe(false);
  });

  it('detects overlap when a child crosses a rotated edge', () => {
    const rotated = frame({ rotation: Math.PI / 4 });
    expect(
      frameOverlapsBounds(rotated, {
        minX: 195,
        minY: 120,
        maxX: 230,
        maxY: 150,
      }),
    ).toBe(true);
    expect(
      frameOverlapsBounds(rotated, {
        minX: 500,
        minY: 500,
        maxX: 540,
        maxY: 540,
      }),
    ).toBe(false);
  });
});
