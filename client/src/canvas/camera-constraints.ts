import { clampZoom, DEFAULT_CAMERA, MAX_ZOOM, MIN_ZOOM, type Camera, type Point } from './camera';
import type { Bounds } from './geometry';

export type CameraConstraintBehavior = 'free' | 'fixed' | 'inside' | 'outside' | 'contain';
export type CameraFitZoom = 'default' | 'fit-min' | 'fit-max' | 'fit-x' | 'fit-y';
export interface CameraViewport { width: number; height: number }

/** Optional session-only limits for a slide or artboard. Unset means infinite. */
export interface CameraConstraints {
  bounds: Bounds;
  padding?: Point;
  origin?: Point;
  initialZoom?: CameraFitZoom;
  baseZoom?: CameraFitZoom;
  minZoom?: number;
  maxZoom?: number;
  behavior: CameraConstraintBehavior | { x: CameraConstraintBehavior; y: CameraConstraintBehavior };
}

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const finite = (n: number | undefined, fallback: number) => Number.isFinite(n) ? n! : fallback;

export function cameraFitZoom(constraints: CameraConstraints | null, viewport: CameraViewport, mode: CameraFitZoom = 'default'): number {
  if (!constraints || mode === 'default') return 1;
  const { bounds, padding } = constraints;
  const w = bounds.maxX - bounds.minX, h = bounds.maxY - bounds.minY;
  if (!(w > 0 && h > 0 && viewport.width > 0 && viewport.height > 0)) return 1;
  const x = Math.max(1, viewport.width - 2 * Math.max(0, finite(padding?.x, 0))) / w;
  const y = Math.max(1, viewport.height - 2 * Math.max(0, finite(padding?.y, 0))) / h;
  return clampZoom(mode === 'fit-x' ? x : mode === 'fit-y' ? y : mode === 'fit-min' ? Math.min(x, y) : Math.max(x, y));
}

/** The app stores the world's top-left, the negative of the reference's
 * translation. Keep that existing document/presence contract at this boundary. */
export function constrainCamera(
  requested: Camera,
  current: Camera = DEFAULT_CAMERA,
  constraints: CameraConstraints | null = null,
  viewport: CameraViewport = { width: 0, height: 0 },
  preserveFocalPoint = true,
): Camera {
  const min = clampZoom(finite(constraints?.minZoom, MIN_ZOOM));
  const max = Math.max(min, clampZoom(finite(constraints?.maxZoom, MAX_ZOOM)));
  const rz = finite(requested.z, current.z);
  const z = clamp(rz, min, max);
  let x = finite(requested.x, current.x), y = finite(requested.y, current.y);
  if (preserveFocalPoint && rz > 0 && rz !== z && rz !== current.z) {
    const ratio = (1 / z - 1 / current.z) / (1 / rz - 1 / current.z);
    x = current.x + (x - current.x) * ratio;
    y = current.y + (y - current.y) * ratio;
  }
  if (!constraints || viewport.width <= 0 || viewport.height <= 0) return { x, y, z };
  const { bounds, behavior, padding, origin } = constraints;
  if (![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite) || bounds.maxX <= bounds.minX || bounds.maxY <= bounds.minY) return { x, y, z };
  const axis = (value: number, start: number, end: number, size: number, pad: number | undefined, at: number | undefined, mode: CameraConstraintBehavior) => {
    const p = clamp(finite(pad, 0), 0, Math.max(0, (size - 1) / 2));
    const leading = start - p / z;
    const trailing = end - (size - p) / z;
    const aligned = leading + (trailing - leading) * clamp(finite(at, 0.5), 0, 1);
    if (mode === 'fixed' || (mode === 'contain' && trailing < leading)) return aligned;
    if (mode === 'inside' || mode === 'contain') return clamp(value, Math.min(leading, trailing), Math.max(leading, trailing));
    if (mode === 'outside') return clamp(value, start - (size - p) / z, end - p / z);
    return value;
  };
  return {
    x: axis(x, bounds.minX, bounds.maxX, viewport.width, padding?.x, origin?.x, typeof behavior === 'string' ? behavior : behavior.x),
    y: axis(y, bounds.minY, bounds.maxY, viewport.height, padding?.y, origin?.y, typeof behavior === 'string' ? behavior : behavior.y),
    z,
  };
}
