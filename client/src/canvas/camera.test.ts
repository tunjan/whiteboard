import { describe, expect, it } from 'vitest';
import {
  nextDiscreteZoom,
  screenToWorld,
  worldToScreen,
  zoomCameraAtScreen,
  zoomCameraAtScreenWithPan,
} from './camera';

describe('camera zoom math', () => {
  it('keeps the screen anchor pinned when zooming', () => {
    const camera = { x: 120, y: -40, z: 2 };
    const anchor = { x: 320, y: 180 };
    const before = screenToWorld(anchor, camera);
    const next = zoomCameraAtScreen(camera, anchor, 4);
    const after = screenToWorld(anchor, next);

    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('combines pinch zooming with midpoint panning', () => {
    const camera = { x: 20, y: 60, z: 2 };
    const previousMidpoint = { x: 100, y: 140 };
    const midpoint = { x: 128, y: 124 };
    const panDelta = {
      x: midpoint.x - previousMidpoint.x,
      y: midpoint.y - previousMidpoint.y,
    };
    const worldUnderPreviousMidpoint = screenToWorld(previousMidpoint, camera);

    const next = zoomCameraAtScreenWithPan(camera, midpoint, 3, panDelta);
    const screenAfter = worldToScreen(worldUnderPreviousMidpoint, next);

    expect(screenAfter.x).toBeCloseTo(midpoint.x);
    expect(screenAfter.y).toBeCloseTo(midpoint.y);
  });

  it('chooses discrete zoom targets using midpoint thresholds', () => {
    expect(nextDiscreteZoom(1, 'in')).toBe(2);
    expect(nextDiscreteZoom(1, 'out')).toBe(0.5);
    expect(nextDiscreteZoom(1.4, 'in')).toBe(2);
    expect(nextDiscreteZoom(1.6, 'in')).toBe(4);
    expect(nextDiscreteZoom(1.6, 'out')).toBe(1);
  });
});
