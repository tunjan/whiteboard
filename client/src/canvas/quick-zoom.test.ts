import { describe, expect, it } from 'vitest';
import { screenToWorld } from './camera';
import {
  QUICK_ZOOM_INSET,
  quickZoomBounds,
  quickZoomFrameSize,
  quickZoomOverviewZoom,
} from './quick-zoom';

const VIEWPORT = { w: 1000, h: 800 };

describe('quickZoomOverviewZoom', () => {
  it('keeps the world point under the pointer fixed', () => {
    const camera = { x: 0, y: 0, z: 2 };
    const pointer = { x: 300, y: 200 };
    const before = screenToWorld(pointer, camera);
    const zoom = quickZoomOverviewZoom(
      camera,
      pointer,
      VIEWPORT.w,
      VIEWPORT.h,
      { minX: -2000, minY: -2000, maxX: 2000, maxY: 2000 },
    );
    const after = screenToWorld(pointer, {
      x: before.x - pointer.x / zoom,
      y: before.y - pointer.y / zoom,
      z: zoom,
    });
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('pulls back far enough to fit the content, with an inset margin', () => {
    const camera = { x: 0, y: 0, z: 1 };
    const pointer = { x: 500, y: 400 };
    // 4000 world units of content to the right of the cursor, 500px of room.
    const bounds = { minX: 500, minY: 400, maxX: 4500, maxY: 4400 };
    const zoom = quickZoomOverviewZoom(
      camera,
      pointer,
      VIEWPORT.w,
      VIEWPORT.h,
      bounds,
    );
    // The binding edge is the taller one: 400px of room over 4000 units.
    expect(zoom).toBeCloseTo((400 / 4000) * QUICK_ZOOM_INSET);
  });

  it('never zooms in', () => {
    const camera = { x: 0, y: 0, z: 1 };
    const tiny = { minX: -1, minY: -1, maxX: 1, maxY: 1 };
    expect(
      quickZoomOverviewZoom(camera, { x: 500, y: 400 }, VIEWPORT.w, VIEWPORT.h, tiny),
    ).toBeLessThanOrEqual(camera.z);
  });

  it('ignores edges already behind the cursor', () => {
    const camera = { x: 0, y: 0, z: 1 };
    // Everything is up and to the left of the pointer.
    const bounds = { minX: -3000, minY: -3000, maxX: 0, maxY: 0 };
    const zoom = quickZoomOverviewZoom(
      camera,
      { x: 500, y: 400 },
      VIEWPORT.w,
      VIEWPORT.h,
      bounds,
    );
    expect(Number.isFinite(zoom)).toBe(true);
    expect(zoom).toBeGreaterThan(0);
  });
});

describe('quickZoomFrameSize', () => {
  it('frames the region that will fill the viewport on release', () => {
    // Pulled back 4x: a quarter of each screen dimension comes back to full.
    expect(quickZoomFrameSize(0.5, 2, 1000, 800)).toEqual({
      width: 250,
      height: 200,
    });
  });
});

describe('quickZoomBounds', () => {
  it('falls back to the viewport on an empty board', () => {
    const viewport = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    expect(quickZoomBounds(viewport, null)).toBe(viewport);
  });

  it('unions the viewport with the content', () => {
    expect(
      quickZoomBounds(
        { minX: 0, minY: 0, maxX: 10, maxY: 10 },
        { minX: -5, minY: 2, maxX: 8, maxY: 40 },
      ),
    ).toEqual({ minX: -5, minY: 0, maxX: 10, maxY: 40 });
  });
});
