// Mobile one-finger zoom: double-tap and hold, then drag down to zoom in / up
// to zoom out. The only zoom gesture that leaves the other hand free.

/** Gap between the two taps that still reads as a double-tap. */
export const DOUBLE_TAP_MS = 300;
/** How far the second tap may land from the first and still pair with it. */
export const DOUBLE_TAP_SLOP = 30;
/** Vertical drag that doubles (down) or halves (up) the zoom. */
export const ONE_FINGER_ZOOM_RANGE = 200;

/**
 * Zoom multiplier for a vertical drag of `dy` screen pixels from the point the
 * gesture started (positive = downward = zoom in).
 */
export function oneFingerZoomFactor(dy: number): number {
  return 2 ** (dy / ONE_FINGER_ZOOM_RANGE);
}

/** Whether a tap at `point`/`time` pairs with the preceding one. */
export function isDoubleTap(
  previous: { x: number; y: number; t: number } | null,
  point: { x: number; y: number },
  time: number,
): boolean {
  if (!previous) return false;
  return (
    time - previous.t < DOUBLE_TAP_MS &&
    Math.hypot(point.x - previous.x, point.y - previous.y) < DOUBLE_TAP_SLOP
  );
}
