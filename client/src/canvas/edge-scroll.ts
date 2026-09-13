// Edge scrolling: dragging a shape (or a selection marquee) against the edge of
// the viewport pans the camera, so a drag isn't limited to what's on screen.

import type { Point } from './camera';

/** Margin from each viewport edge inside which a drag starts panning. */
export const EDGE_SCROLL_DISTANCE = 32;
/**
 * Pan speed at full proximity, in screen px/ms (~24 px per 60 Hz frame).
 * Quoted per millisecond rather than per frame so the pan covers the same
 * ground per second on a 60 and a 120 Hz display.
 */
export const EDGE_SCROLL_SPEED = 1.5;
/** How long the pointer must sit in the margin before panning begins. */
export const EDGE_SCROLL_DELAY_MS = 200;
/** Ease-in ramp length once panning has begun. */
export const EDGE_SCROLL_EASE_MS = 500;
/** Viewport size under which panning is slowed, to stay legible on a phone. */
export const EDGE_SCROLL_SMALL_VIEWPORT = 1000;
export const EDGE_SCROLL_SMALL_FACTOR = 0.612;

/**
 * How deep into an edge margin `value` sits, as a signed fraction in [-1, 1]:
 * positive near the low edge (pan the content right/down), negative near the
 * high edge, zero in the comfortable middle.
 */
export function edgeProximity(
  value: number,
  extent: number,
  distance = EDGE_SCROLL_DISTANCE,
): number {
  if (distance <= 0 || extent <= 0) return 0;
  if (value < distance) return Math.min(1, (distance - value) / distance);
  const high = extent - distance;
  if (value > high) return -Math.min(1, (value - high) / distance);
  return 0;
}

/** Proximity on both axes for a pointer at `point` in a `w`x`h` viewport. */
export function edgeProximityVector(
  point: Point,
  w: number,
  h: number,
  distance = EDGE_SCROLL_DISTANCE,
): Point {
  return {
    x: edgeProximity(point.x, w, distance),
    y: edgeProximity(point.y, h, distance),
  };
}

/**
 * Cubic ease-in ramp on the time spent in the margin. The flat delay is what
 * stops a drag that merely crosses the edge zone on its way somewhere else from
 * yanking the camera; the ramp then keeps the start of a deliberate hold gentle.
 */
export function edgeScrollRamp(elapsedMs: number): number {
  if (elapsedMs < EDGE_SCROLL_DELAY_MS) return 0;
  const t = (elapsedMs - EDGE_SCROLL_DELAY_MS) / EDGE_SCROLL_EASE_MS;
  return t >= 1 ? 1 : t ** 3;
}

/**
 * Screen-pixel camera offset for one frame of edge scrolling. The sign is the
 * camera's: the pointer near the left edge (`proximity.x > 0`) moves the camera
 * left, which brings content in from the left.
 */
export function edgeScrollDelta(
  proximity: Point,
  viewportW: number,
  viewportH: number,
  elapsedMs: number,
  frameMs: number,
): Point {
  const ramp = edgeScrollRamp(elapsedMs);
  if (ramp === 0 || (proximity.x === 0 && proximity.y === 0)) {
    return { x: 0, y: 0 };
  }
  const fx =
    viewportW < EDGE_SCROLL_SMALL_VIEWPORT ? EDGE_SCROLL_SMALL_FACTOR : 1;
  const fy =
    viewportH < EDGE_SCROLL_SMALL_VIEWPORT ? EDGE_SCROLL_SMALL_FACTOR : 1;
  const speed = EDGE_SCROLL_SPEED * ramp * frameMs;
  return {
    x: -proximity.x * fx * speed,
    y: -proximity.y * fy * speed,
  };
}
