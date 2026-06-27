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

export const ZOOM_STEPS = [0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8] as const;
export const MIN_ZOOM = ZOOM_STEPS[0]!;
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1]!;
export const DEFAULT_BASE_ZOOM = 1;

/**
 * Below this zoom, expensive per-shape effects (drop shadows) are dropped — they
 * become sub-pixel and not worth compositing. See `useLodDetail`.
 */
export const LOD_ZOOM_THRESHOLD = 0.4;

export type ZoomDirection = 'in' | 'out';

export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

export function discreteZoomSteps(baseZoom = DEFAULT_BASE_ZOOM): number[] {
  const unique = new Set<number>();
  for (const step of ZOOM_STEPS) unique.add(clampZoom(step * baseZoom));
  return [...unique].sort((a, b) => a - b);
}

export function nextDiscreteZoom(
  currentZoom: number,
  direction: ZoomDirection,
  baseZoom = DEFAULT_BASE_ZOOM,
): number {
  const steps = discreteZoomSteps(baseZoom);
  const z = clampZoom(currentZoom);

  if (direction === 'in') {
    for (let i = 1; i < steps.length; i++) {
      const z1 = steps[i - 1]!;
      const z2 = steps[i]!;
      if (z < (z1 + z2) / 2) return z2;
    }
    return steps[steps.length - 1]!;
  }

  for (let i = steps.length - 2; i >= 0; i--) {
    const z1 = steps[i]!;
    const z2 = steps[i + 1]!;
    if (z > (z1 + z2) / 2) return z1;
  }
  return steps[0]!;
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
 *
 * The translate components are snapped to the device-pixel grid (ε(s)) so the
 * composited shape layer's origin lands on a physical pixel — the standard
 * mitigation for blurry edges / jitter at fractional zoom (notably in Safari).
 * Hit-testing still uses the exact, un-snapped math in {@link screenToWorld}, so
 * this adds at most a sub-device-pixel discrepancy with the overlays.
 */
export function cameraToTransform(camera: Camera): string {
  const dpr =
    (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const e = Math.round(-camera.x * camera.z * dpr) / dpr;
  const f = Math.round(-camera.y * camera.z * dpr) / dpr;
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

/**
 * Pinch gestures need to keep the zoom anchor stable while also letting the
 * content follow the moving gesture midpoint. `panDelta` is in screen pixels.
 */
export function zoomCameraAtScreenWithPan(
  camera: Camera,
  anchor: Point,
  newZ: number,
  panDelta: Point,
): Camera {
  const z = clampZoom(newZ);
  return {
    x: camera.x - panDelta.x / camera.z + anchor.x / camera.z - anchor.x / z,
    y: camera.y - panDelta.y / camera.z + anchor.y / camera.z - anchor.y / z,
    z,
  };
}
