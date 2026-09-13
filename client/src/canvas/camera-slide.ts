// Inertial pan: releasing a drag with speed left in it lets the camera coast to
// a stop instead of stopping dead under the finger.

import type { Point } from './camera';

/** Release speed (screen px/ms) below which a drag is a stop, not a throw. */
export const SLIDE_MIN_RELEASE_SPEED = 0.1;
/** Cap on the initial coast speed, so a flick can't launch the camera. */
export const SLIDE_MAX_SPEED = 2;
/** Fraction of speed shed per {@link SLIDE_REFERENCE_FRAME_MS} of coasting. */
export const SLIDE_FRICTION = 0.1;
/**
 * The frame {@link SLIDE_FRICTION} is quoted at: one 60Hz frame. Friction is
 * re-expressed for each step's real elapsed time against this, the way
 * `InputsManager` re-expresses its own smoothing, so a coast covers the same
 * ground over the same wall-clock time at 60, 120 or 240Hz.
 */
export const SLIDE_REFERENCE_FRAME_MS = 1000 / 60;
/** Speed at which the remaining motion is sub-pixel and the coast ends. */
export const SLIDE_STOP_SPEED = 0.01;
/**
 * Longest step the coast will integrate in one go.
 *
 * A coast is driven from rAF, so a stalled tab or a long hitch can deliver a
 * step hundreds of ms wide. Honouring it faithfully is *correct* and looks
 * wrong: the camera teleports most of the way to its resting place in a single
 * frame. Four 60Hz frames is past anything a healthy display produces and short
 * enough that the jump stays a stutter rather than a jump cut.
 */
export const SLIDE_MAX_STEP_MS = 4 * SLIDE_REFERENCE_FRAME_MS;

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
 * Decay constant, in inverse ms: velocity follows `v(t) = v0 * exp(-DECAY * t)`,
 * which is {@link SLIDE_FRICTION} shed per {@link SLIDE_REFERENCE_FRAME_MS}.
 */
const DECAY = -Math.log(1 - SLIDE_FRICTION) / SLIDE_REFERENCE_FRAME_MS;

/**
 * How much a velocity decaying at {@link DECAY} accumulates over `dt`, per unit
 * of starting velocity: the integral of `exp(-DECAY * t)` from 0 to `dt`.
 *
 * The integral rather than `dt` because the velocity is falling *during* the
 * step; multiplying the step's opening speed by its full width over-travels
 * every frame, and by more the longer the frame. It is also what makes a step
 * splittable — two half-steps accumulate exactly what one whole step does, so
 * the coast is blind to when frames are delivered.
 */
function integrateDecay(dt: number): number {
  return (1 - Math.exp(-DECAY * dt)) / DECAY;
}

/**
 * Advance a coast by `elapsedMs`, returning the screen-pixel offset travelled,
 * the factor to multiply the zoom by, and the decayed state (null once it has
 * come to rest).
 *
 * Both channels are integrated and decayed over the real elapsed time, so the
 * same throw covers the same ground over the same wall-clock time whatever the
 * refresh rate, and a dropped frame costs smoothness rather than distance.
 * Steps wider than {@link SLIDE_MAX_STEP_MS} are clamped.
 */
export function stepCameraSlide(
  slide: CameraSlide,
  elapsedMs: number,
): { dx: number; dy: number; zoomFactor: number; next: CameraSlide | null } {
  const dt = Math.min(Math.max(0, elapsedMs), SLIDE_MAX_STEP_MS);
  const accumulated = integrateDecay(dt);
  const decay = Math.exp(-DECAY * dt);
  const travelled = slide.speed * accumulated;
  const speed = slide.speed * decay;
  const zoomRate = slide.zoomRate * decay;
  const resting =
    speed < SLIDE_STOP_SPEED && Math.abs(zoomRate) < SLIDE_STOP_ZOOM_RATE;
  return {
    dx: slide.ux * travelled,
    dy: slide.uy * travelled,
    zoomFactor:
      slide.zoomRate === 0 ? 1 : Math.exp(slide.zoomRate * accumulated),
    next: resting ? null : { ...slide, speed, zoomRate },
  };
}
