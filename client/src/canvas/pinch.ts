import { MAX_ZOOM, MIN_ZOOM, clampZoom, type Point } from './camera';

// Pinch zoom feel. Kept at 1:1 so a two-finger spread maps directly to zoom
// and the midpoint maps directly to pan (matches the legacy touch handler).
export const TOUCH_ZOOM_SPEED = 1;
export const TOUCH_PAN_SPEED = 1;

export interface TouchGesture {
  midpoint: Point;
  distance: number;
}

/**
 * Which interpretation of a two-finger gesture the canvas has committed to.
 * `unsure` moves nothing: it is the deadband that keeps the small, incidental
 * finger drift at the start of a gesture from nudging the camera.
 */
export type PinchMode = 'unsure' | 'panning' | 'zooming';

export interface PinchState {
  startDistance: number;
  startZoom: number;
  startMidpoint: Point;
  lastMidpoint: Point;
  mode: PinchMode;
}

/** Finger separation change that classifies an undecided gesture as a zoom. */
export const PINCH_ZOOM_THRESHOLD = 24;
/** Midpoint travel that classifies an undecided gesture as a pan. */
export const PINCH_PAN_THRESHOLD = 16;
/**
 * Separation change that upgrades an established pan to a zoom. Wider than
 * {@link PINCH_ZOOM_THRESHOLD} so a pan that spreads slightly does not flip
 * back and forth across the boundary.
 */
export const PINCH_ZOOM_UPGRADE_THRESHOLD = 64;

/**
 * Advance the pan/zoom disambiguation state machine. Zooming is absorbing: once
 * a gesture zooms it keeps zooming, because re-classifying it mid-flight would
 * strand the camera at whatever scale it had reached.
 */
export function nextPinchMode(
  mode: PinchMode,
  start: { distance: number; midpoint: Point },
  current: TouchGesture,
): PinchMode {
  if (mode === 'zooming') return 'zooming';
  const spread = Math.abs(current.distance - start.distance);
  if (mode === 'panning')
    return spread > PINCH_ZOOM_UPGRADE_THRESHOLD ? 'zooming' : 'panning';
  if (spread > PINCH_ZOOM_THRESHOLD) return 'zooming';
  const travel = Math.hypot(
    current.midpoint.x - start.midpoint.x,
    current.midpoint.y - start.midpoint.y,
  );
  return travel > PINCH_PAN_THRESHOLD ? 'panning' : 'unsure';
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
