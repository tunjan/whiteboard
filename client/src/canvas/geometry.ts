// Geometry primitives live in @whiteboard/shared (single source of truth).
// This module re-exports them and adds the client-only viewport helper that
// depends on the camera.

import type { Camera } from './camera';
import type { Bounds } from '@whiteboard/shared';

export type { Vec, Point, Box, Bounds } from '@whiteboard/shared';
export {
  boxToBounds,
  boundsToBox,
  boundsIntersect,
  boundsContainsPoint,
  unionBounds,
  boundsCenter,
  pointsBounds,
  rotatePoint,
  distance,
  distanceToSegment,
} from '@whiteboard/shared';

/** World-space rectangle currently visible in a `width`x`height` viewport. */
export function viewportWorldBounds(
  camera: Camera,
  width: number,
  height: number,
): Bounds {
  return {
    minX: camera.x,
    minY: camera.y,
    maxX: camera.x + width / camera.z,
    maxY: camera.y + height / camera.z,
  };
}

// Viewport-relative overscan (kept mounted past the edges) and the grid step the
// cull region snaps to. OVERSCAN > QUANTIZE guarantees a shape is already
// mounted before it can scroll into view, so quantizing never causes popping.
const CULL_OVERSCAN = 0.25;
const CULL_QUANTIZE = 0.1;

/**
 * Cull region for viewport mounting: the visible world rect expanded by an
 * overscan margin, then snapped to a coarse grid. Snapping makes the region
 * identical across small pans, so the (memoized) visible-shape computation only
 * re-runs when the camera crosses a grid cell — not on every animation frame.
 */
export function quantizedCullRegion(
  camera: Camera,
  width: number,
  height: number,
): Bounds {
  const vb = viewportWorldBounds(camera, width, height);
  const w = vb.maxX - vb.minX;
  const h = vb.maxY - vb.minY;
  const marginX = w * CULL_OVERSCAN;
  const marginY = h * CULL_OVERSCAN;
  const cellX = w * CULL_QUANTIZE || 1;
  const cellY = h * CULL_QUANTIZE || 1;
  return {
    minX: Math.floor((vb.minX - marginX) / cellX) * cellX,
    minY: Math.floor((vb.minY - marginY) / cellY) * cellY,
    maxX: Math.ceil((vb.maxX + marginX) / cellX) * cellX,
    maxY: Math.ceil((vb.maxY + marginY) / cellY) * cellY,
  };
}
