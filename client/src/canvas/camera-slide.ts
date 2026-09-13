// Inertial pan: releasing a drag with speed left in it lets the camera coast to
// a stop instead of stopping dead under the finger.

import type { Point } from './camera';

/** Release speed (screen px/ms) below which a drag is a stop, not a throw. */
export const SLIDE_MIN_RELEASE_SPEED = 0.1;
/** Cap on the initial coast speed, so a flick can't launch the camera. */
export const SLIDE_MAX_SPEED = 2;
/** Fraction of speed shed per animation frame. */
export const SLIDE_FRICTION = 0.1;
/** Speed at which the remaining motion is sub-pixel and the coast ends. */
export const SLIDE_STOP_SPEED = 0.01;

/**
 * Release zoom rate (natural-log zoom units per ms) below which a pinch is a
 * scale that was set, not thrown. A pinch that doubles the zoom over 300ms
 * runs at ~0.0023, so this asks for roughly half that pace at the lift.
 */
export const SLIDE_MIN_RELEASE_ZOOM_RATE = 0.001;
/** Cap on the initial zoom rate — ~1.2x per 16ms frame at the fastest. */
export const SLIDE_MAX_ZOOM_RATE = 0.01;
/** Zoom rate at which the remaining scale change stops reading, ending the coast. */
export const SLIDE_STOP_ZOOM_RATE = 0.0001;

export interface CameraSlide {
  /** Unit direction of travel, in screen space. */
  ux: number;
  uy: number;
  /** Current speed in screen px/ms. */
  speed: number;
  /**
   * Current zoom velocity, in natural-log zoom units per ms. Zoom is integrated
   * exponentially (`z *= exp(rate * dt)`) rather than linearly, which is what
   * keeps it positive however long the coast runs and makes a coast that
   * doubles the scale cost the same rate as one that halves it.
   */
  zoomRate: number;
}

function clampMagnitude(value: number, max: number): number {
  return Math.sign(value) * Math.min(Math.abs(value), max);
}

/**
 * Turn a release velocity (screen px/ms, as produced by `InputsManager`) and an
 * optional zoom rate (ln-zoom units per ms, as produced by a pinch) into a
 * coast, or null if the gesture ended too slowly to be a throw. Either channel
 * on its own is enough to coast: a pinch that lifts mid-scale carries no
 * translation, and a pan carries no scale.
 */
export function beginCameraSlide(
  velocity: Point,
  zoomRate = 0,
): CameraSlide | null {
  const speed = Math.hypot(velocity.x, velocity.y);
  const rate = Number.isFinite(zoomRate) ? zoomRate : 0;
  if (!Number.isFinite(speed)) return null;
  const throwsPan = speed > SLIDE_MIN_RELEASE_SPEED;
  const throwsZoom = Math.abs(rate) > SLIDE_MIN_RELEASE_ZOOM_RATE;
  if (!throwsPan && !throwsZoom) return null;
  return {
    ux: throwsPan ? velocity.x / speed : 0,
    uy: throwsPan ? velocity.y / speed : 0,
    speed: throwsPan ? Math.min(speed, SLIDE_MAX_SPEED) : 0,
    zoomRate: throwsZoom ? clampMagnitude(rate, SLIDE_MAX_ZOOM_RATE) : 0,
  };
}

/**
 * Advance a coast by `elapsedMs`, returning the screen-pixel offset travelled,
 * the factor to multiply the zoom by, and the decayed state (null once it has
 * come to rest).
 *
 * Both channels are integrated over the real elapsed time but decayed once per
 * call, as the source spec specifies. That ties the length of a coast to the
 * display's refresh rate — the same throw travels about half as far at 120Hz as
 * at 60Hz, because the friction sheds the same fraction twice as often.
 */
export function stepCameraSlide(
  slide: CameraSlide,
  elapsedMs: number,
): { dx: number; dy: number; zoomFactor: number; next: CameraSlide | null } {
  const dt = Math.max(0, elapsedMs);
  const travelled = slide.speed * dt;
  const speed = slide.speed * (1 - SLIDE_FRICTION);
  const zoomRate = slide.zoomRate * (1 - SLIDE_FRICTION);
  const resting =
    speed < SLIDE_STOP_SPEED && Math.abs(zoomRate) < SLIDE_STOP_ZOOM_RATE;
  return {
    dx: slide.ux * travelled,
    dy: slide.uy * travelled,
    zoomFactor: slide.zoomRate === 0 ? 1 : Math.exp(slide.zoomRate * dt),
    next: resting ? null : { ...slide, speed, zoomRate },
  };
}
