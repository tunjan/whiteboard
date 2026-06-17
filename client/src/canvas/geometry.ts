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
