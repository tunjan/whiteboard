import { MAX_ZOOM, MIN_ZOOM, clampZoom, type Point } from './camera';

// Pinch zoom feel. Kept at 1:1 so a two-finger spread maps directly to zoom
// and the midpoint maps directly to pan (matches the legacy touch handler).
export const TOUCH_ZOOM_SPEED = 1;
export const TOUCH_PAN_SPEED = 1;

export interface TouchGesture {
  midpoint: Point;
  distance: number;
}

export interface PinchState {
  startDistance: number;
  startZoom: number;
  lastMidpoint: Point;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

// Drop touch entries whose last event is older than `staleMs`. This is how the
// canvas recovers when iOS swallows a pointerup/cancel: the ghost is pruned on
// the next interaction instead of latching the surface forever. Mutates `touches`.
export function pruneStaleTouches<T extends { t: number }>(
  touches: Map<number, T>,
  now: number,
  staleMs: number,
): void {
  for (const [id, p] of touches) {
    if (now - p.t > staleMs) touches.delete(id);
  }
}

// Midpoint + finger separation for two container-relative points.
export function pinchGesture(a: Point, b: Point): TouchGesture {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return {
    midpoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    distance: Math.hypot(dx, dy),
  };
}

export function zoomFromDistance(
  startZoom: number,
  startDistance: number,
  currentDistance: number,
): number {
  if (startDistance <= 0) return startZoom;

  const minRaw = Math.pow(MIN_ZOOM, 1 / TOUCH_ZOOM_SPEED);
  const maxRaw = Math.pow(MAX_ZOOM, 1 / TOUCH_ZOOM_SPEED);
  const raw =
    Math.pow(startZoom, 1 / TOUCH_ZOOM_SPEED) *
    (currentDistance / startDistance);

  return clampZoom(Math.pow(clamp(raw, minRaw, maxRaw), TOUCH_ZOOM_SPEED));
}
