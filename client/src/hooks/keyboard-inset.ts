/**
 * How much of the layout viewport's bottom edge the on-screen keyboard covers.
 *
 * iPadOS does not shrink the layout viewport when the keyboard comes up: the
 * page keeps its full height and the keyboard is drawn over the bottom of it,
 * so anything anchored there — the toolbar, the zoom HUD, the call panel — is
 * simply behind it. Only the *visual* viewport knows, and it reports the
 * covered strip as height lost from the bottom plus however far Safari has
 * scrolled the visual viewport up to reveal the focused field.
 */

/**
 * Ignore anything smaller than this. Safari's own collapsing address bar and
 * the rounding between the two viewports both move the number by a few pixels
 * with no keyboard anywhere, and lifting the whole UI by 6px on a scroll would
 * read as a glitch. No real keyboard is anywhere near this short.
 */
export const KEYBOARD_INSET_THRESHOLD = 120;

export interface ViewportMetrics {
  /** Layout viewport height (`window.innerHeight`). */
  layoutHeight: number;
  /** `visualViewport.height`. */
  visualHeight: number;
  /** `visualViewport.offsetTop` — how far the visual viewport has scrolled. */
  offsetTop: number;
}

/** The covered strip in CSS pixels, or 0 when no keyboard is up. */
export function keyboardInset(metrics: ViewportMetrics): number {
  const covered =
    metrics.layoutHeight - (metrics.visualHeight + metrics.offsetTop);
  if (!Number.isFinite(covered) || covered < KEYBOARD_INSET_THRESHOLD) return 0;
  return Math.round(covered);
}
