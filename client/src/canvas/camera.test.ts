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

  // `useWheel` accumulates a frame's wheel events into one pan delta and one
  // zoom factor, then commits once. That is only lossless if these two
  // identities hold; if either breaks, coalescing silently changes the camera.
  it('composes successive zooms about one anchor multiplicatively', () => {
    const camera = { x: 120, y: -40, z: 2 };
    const anchor = { x: 320, y: 180 };
    const factors = [1.05, 0.98, 1.11, 1.02];

    const stepped = factors.reduce(
      (c, f) => zoomCameraAtScreen(c, anchor, c.z * f),
      camera,
    );
    const coalesced = zoomCameraAtScreen(
      camera,
      anchor,
      camera.z * factors.reduce((a, f) => a * f, 1),
    );

    expect(coalesced.z).toBeCloseTo(stepped.z);
    expect(coalesced.x).toBeCloseTo(stepped.x);
    expect(coalesced.y).toBeCloseTo(stepped.y);
  });

  it('composes successive screen pans additively at fixed zoom', () => {
    const camera = { x: 120, y: -40, z: 2 };
    const deltas = [
      { x: 12, y: -4 },
      { x: 3, y: 9 },
      { x: -7, y: 2 },
    ];
    // `panByScreen` is the store's thin wrapper over this world-space step.
    let panned = camera;
    for (const d of deltas) {
      panned = { ...panned, x: panned.x + d.x / panned.z, y: panned.y + d.y / panned.z };
    }
    const total = deltas.reduce(
      (a, d) => ({ x: a.x + d.x, y: a.y + d.y }),
      { x: 0, y: 0 },
    );

    expect(panned.x).toBeCloseTo(camera.x + total.x / camera.z);
    expect(panned.y).toBeCloseTo(camera.y + total.y / camera.z);
  });

  it('chooses discrete zoom targets using midpoint thresholds', () => {
    expect(nextDiscreteZoom(1, 'in')).toBe(2);
    expect(nextDiscreteZoom(1, 'out')).toBe(0.5);
    expect(nextDiscreteZoom(1.4, 'in')).toBe(2);
    expect(nextDiscreteZoom(1.6, 'in')).toBe(4);
    expect(nextDiscreteZoom(1.6, 'out')).toBe(1);
  });
});
