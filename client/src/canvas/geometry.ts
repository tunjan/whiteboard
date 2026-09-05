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

// Zoom is banded to powers of √2 before it sizes the region. Deriving the region
// from the live zoom made it shrink and grow continuously through a pinch, so
// the snapped region moved on essentially every frame and the quantization
// bought zoom nothing. Within a band the region keeps one size and one grid, so
// a pinch crosses a handful of cell boundaries instead of re-cutting the grid
// under itself.
const CULL_ZOOM_BAND = Math.SQRT2;

function bandedZoom(z: number): number {
  if (!Number.isFinite(z) || z <= 0) return 1;
  return CULL_ZOOM_BAND ** Math.round(Math.log(z) / Math.log(CULL_ZOOM_BAND));
}

/**
 * Cull region for viewport mounting: the visible world rect expanded by an
 * overscan margin, then snapped to a coarse grid. Snapping makes the region
 * identical across small pans and small zooms, so the (memoized) visible-shape
 * computation only re-runs when the camera crosses a grid cell — not on every
 * animation frame.
 *
 * Both the region's size and its grid come from the *widest* viewport the
 * current zoom band can show, not from the live zoom. Sizing only the grid that
 * way still left the region's edges tracking a viewport that grows and shrinks
 * continuously, so a zoom re-cut it every few frames and rebuilt the whole
 * mounted shape tree with it — measurably the most expensive thing a zoom did,
 * while a pan of the same distance rebuilt nothing. Pinned to the band, a zoom
 * about the viewport centre holds one region for the whole band, and an
 * off-centre one only moves as fast as the centre it drags.
 *
 * The region is always at least the live overscanned viewport: the band's
 * widest viewport contains every viewport in the band, both are centred on the
 * same world point, and the snap is outward.
 */
export function quantizedCullRegion(
  camera: Camera,
  width: number,
  height: number,
): Bounds {
  // TEMPORARY A/B flag — revert with zoom-bench.ts.
  if (typeof location !== 'undefined' && location.search.includes('oldcull')) {
    const vb = viewportWorldBounds(camera, width, height);
    const ow = vb.maxX - vb.minX;
    const oh = vb.maxY - vb.minY;
    const obz = bandedZoom(camera.z);
    const ocx = (width / obz) * CULL_QUANTIZE || 1;
    const ocy = (height / obz) * CULL_QUANTIZE || 1;
    return {
      minX: Math.floor((vb.minX - ow * CULL_OVERSCAN) / ocx) * ocx,
      minY: Math.floor((vb.minY - oh * CULL_OVERSCAN) / ocy) * ocy,
      maxX: Math.ceil((vb.maxX + ow * CULL_OVERSCAN) / ocx) * ocx,
      maxY: Math.ceil((vb.maxY + oh * CULL_OVERSCAN) / ocy) * ocy,
    };
  }

  // Lower edge of the band, where the viewport covers the most world.
  const bandFloor = bandedZoom(camera.z) / Math.sqrt(CULL_ZOOM_BAND);
  const w = width / bandFloor;
  const h = height / bandFloor;
  const centerX = camera.x + width / (2 * camera.z);
  const centerY = camera.y + height / (2 * camera.z);
  const marginX = w * CULL_OVERSCAN;
  const marginY = h * CULL_OVERSCAN;
  const cellX = w * CULL_QUANTIZE || 1;
  const cellY = h * CULL_QUANTIZE || 1;
  return {
    minX: Math.floor((centerX - w / 2 - marginX) / cellX) * cellX,
    minY: Math.floor((centerY - h / 2 - marginY) / cellY) * cellY,
    maxX: Math.ceil((centerX + w / 2 + marginX) / cellX) * cellX,
    maxY: Math.ceil((centerY + h / 2 + marginY) / cellY) * cellY,
  };
}
