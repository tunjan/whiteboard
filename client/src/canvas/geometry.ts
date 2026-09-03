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
export const CULL_OVERSCAN = 0.25;
const CULL_QUANTIZE = 0.1;

// Zoom is banded to powers of √2 before it sizes the grid cell. Deriving the
// cell from the live zoom made it shrink and grow continuously through a pinch,
// so the snapped region moved on essentially every frame and the quantization
// bought zoom nothing. Banding holds the cell still within ±19% of zoom, so a
// pinch crosses a handful of cell boundaries instead of re-cutting the grid
// under itself. The band widens the cell by at most 1.19x (0.119 of the
// viewport), still comfortably under OVERSCAN.
const CULL_ZOOM_BAND = Math.SQRT2;

function bandedZoom(z: number): number {
  if (!Number.isFinite(z) || z <= 0) return 1;
  return CULL_ZOOM_BAND ** Math.round(Math.log(z) / Math.log(CULL_ZOOM_BAND));
}

/**
 * Cull region for viewport mounting: the visible world rect expanded by an
 * overscan margin, then snapped to a coarse grid whose cell comes from the
 * banded zoom. Snapping makes the region identical across small pans and small
 * zooms, so the (memoized) visible-shape computation only re-runs when the
 * camera crosses a grid cell — not on every animation frame. Snapping is always
 * outward, so the region still contains the full overscanned viewport whatever
 * the cell size.
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
  const bz = bandedZoom(camera.z);
  const cellX = (width / bz) * CULL_QUANTIZE || 1;
  const cellY = (height / bz) * CULL_QUANTIZE || 1;
  return {
    minX: Math.floor((vb.minX - marginX) / cellX) * cellX,
    minY: Math.floor((vb.minY - marginY) / cellY) * cellY,
    maxX: Math.ceil((vb.maxX + marginX) / cellX) * cellX,
    maxY: Math.ceil((vb.maxY + marginY) / cellY) * cellY,
  };
}
