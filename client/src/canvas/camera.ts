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

/**
 * Tolerance for treating the camera as already at actual size (100%).
 *
 * Zoom-to-selection has two answers depending on where it starts, so it needs a
 * test for "is this 100%?" that survives the float error a pinch or an
 * interpolated tween leaves behind — landing on 0.9999999 must still count.
 */
export const ACTUAL_SIZE_EPSILON = 0.01;

/** Whether `zoom` is close enough to 1 to count as actual size. */
export function isActualSize(zoom: number): boolean {
  return Math.abs(zoom - 1) < ACTUAL_SIZE_EPSILON;
}

export type ZoomDirection = 'in' | 'out';

export function clampZoom(z: number): number {
  if (Number.isNaN(z)) return DEFAULT_CAMERA.z;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/** Interpolate the visible world rectangle, including its inverse scale.
 * This also preserves any shared focal point throughout a pure zoom. */
export function interpolateCameraViewport(from: Camera, to: Camera, progress: number): Camera {
  const t = Math.max(0, Math.min(1, progress));
  if (t === 0) return from;
  if (t === 1) return to;
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    z: 1 / ((1 - t) / from.z + t / to.z),
  };
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
 * `snap` lands the translate on the device-pixel grid — see
 * {@link cameraTranslation}. Hit-testing always uses the exact, un-snapped math
 * in {@link screenToWorld}, so snapping adds at most a sub-device-pixel
 * discrepancy against anything positioned from that.
 */
export function cameraToTransform(camera: Camera, snap = true): string {
  const { e, f } = cameraTranslation(camera, snap);
  return `matrix(${camera.z}, 0, 0, ${camera.z}, ${e}, ${f})`;
}

/**
 * The translate components of {@link cameraToTransform}, snapped to the
 * device-pixel grid when `snap`.
 *
 * Snapping makes the layer's origin land on a physical pixel — the standard
 * mitigation for blurry edges at fractional zoom (notably in Safari). But it is
 * a *quantizer*, and while the camera is in motion that is the wrong trade: at
 * dpr 2 the layer advances in 0.5 CSS-px steps, so a slow pan alternates between
 * moving and not moving, and the tail of an inertial coast (final steps are well
 * under a tenth of a pixel) freezes several frames before it comes to rest.
 * Crispness is something you look at while still; stepping is something you see
 * while moving. So callers pass `snap: false` for the duration of a camera
 * gesture and `true` once it settles — `useCameraFollow` in
 * `use-camera-interaction.ts` is the single place that decides which.
 *
 * Every consumer of the world transform must agree on the answer within a
 * frame, or the overlays drift against the shapes they annotate; that is why
 * this is one shared hook rather than a judgement call per layer.
 */
export function cameraTranslation(
  camera: Camera,
  snap = true,
): { e: number; f: number } {
  const e = -camera.x * camera.z;
  const f = -camera.y * camera.z;
  if (!snap) return { e, f };
  const dpr =
    (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  return {
    e: Math.round(e * dpr) / dpr,
    f: Math.round(f * dpr) / dpr,
  };
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
