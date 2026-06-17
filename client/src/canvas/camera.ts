// Core viewport math. The camera is per-user, local state (never in the shared
// CRDT) — every screen<->world conversion in the app goes through here.

import type { Point } from '@whiteboard/shared';

export type { Point };

export interface Camera {
  /** World x-coordinate shown at the viewport's top-left corner. */
  x: number;
  /** World y-coordinate shown at the viewport's top-left corner. */
  y: number;
  /** Zoom factor, in screen pixels per world unit. */
  z: number;
}

export const DEFAULT_CAMERA: Camera = { x: 0, y: 0, z: 1 };

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 32;

export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/**
 * Convert a point in container-relative pixels (e.g. `clientX - rect.left`)
 * to world coordinates.
 */
export function screenToWorld(screen: Point, camera: Camera): Point {
  return {
    x: screen.x / camera.z + camera.x,
    y: screen.y / camera.z + camera.y,
  };
}

/** Convert a world-space point to container-relative pixels. */
export function worldToScreen(world: Point, camera: Camera): Point {
  return {
    x: (world.x - camera.x) * camera.z,
    y: (world.y - camera.y) * camera.z,
  };
}

/**
 * SVG transform for the world-space root `<g>`. A world point (wx, wy) maps to
 * ((wx - x) * z, (wy - y) * z) in screen pixels, matching {@link worldToScreen}.
 */
export function cameraToTransform(camera: Camera): string {
  const e = -camera.x * camera.z;
  const f = -camera.y * camera.z;
  return `matrix(${camera.z}, 0, 0, ${camera.z}, ${e}, ${f})`;
}

/**
 * Zoom to `newZ` (clamped) while keeping the world point currently under
 * `anchor` (container-relative screen px) pinned to that same screen point —
 * i.e. zoom-to-cursor.
 */
export function zoomCameraAtScreen(
  camera: Camera,
  anchor: Point,
  newZ: number,
): Camera {
  const z = clampZoom(newZ);
  const world = screenToWorld(anchor, camera);
  return {
    x: world.x - anchor.x / z,
    y: world.y - anchor.y / z,
    z,
  };
}
