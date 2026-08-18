import type { StrokeDash } from '@whiteboard/shared';
import { LOD_ZOOM_THRESHOLD } from './camera';
import { useCameraStore } from './use-camera-store';

export type LodDetail = 'high' | 'low';

/**
 * Level-of-detail for the current zoom. Returns `'low'` once zoomed out past
 * {@link LOD_ZOOM_THRESHOLD}, where expensive effects (drop shadows) become
 * sub-pixel and not worth compositing. The selector yields a discrete string, so
 * consumers only re-render when the threshold is crossed — never per frame.
 */
export function useLodDetail(): LodDetail {
  return useCameraStore((s) =>
    s.camera.z >= LOD_ZOOM_THRESHOLD ? 'high' : 'low',
  );
}

/** Zoom below which a zero-length dot is too small for the browser to draw. */
const DOT_ZOOM_THRESHOLD = 0.2;

/**
 * Length to give the dots of a dotted stroke, in world units.
 *
 * A dot is normally a zero-length dash relying on the round linecap to paint
 * it, which costs nothing and stays perfectly circular. Zoomed far enough out
 * that cap is sub-pixel and browsers drop it, taking the whole stroke with it;
 * below the threshold the dashes are given real length instead so something
 * still reads on screen. Like {@link useLodDetail} the selector yields a
 * discrete value, so shapes re-render only when the threshold is crossed.
 */
export function useDotLength(): number {
  return useCameraStore((s) => (s.camera.z < DOT_ZOOM_THRESHOLD ? 9 : 0));
}

/** Zoom below which a patterned stroke is no longer worth distinguishing. */
const SOLID_LOD_ZOOM = 0.5;

/** On-screen stroke width, in CSS pixels, below which a pattern stops reading. */
const SOLID_LOD_SCREEN_WIDTH = 1.5;

/**
 * Whether a stroke of `size` world units is too fine at `zoom` to carry a
 * pattern.
 *
 * Both terms are needed. The width test alone would flatten a hairline stroke
 * that is being examined up close, where its dashes are exactly the detail the
 * user zoomed in for; the zoom test alone would flatten a thick stroke seen
 * from far out, whose dashes are still several pixels apart and perfectly
 * legible. A pattern is dropped only when the stroke is both far away and
 * sub-pixel on screen — the case where its gaps fall between device pixels and
 * the anti-aliased remainder reads as a dotted, flickering line rather than as
 * the dashed one it is.
 */
export function isBelowPatternDetail(zoom: number, size: number): boolean {
  return zoom < SOLID_LOD_ZOOM && size * zoom < SOLID_LOD_SCREEN_WIDTH;
}

/**
 * The dash style to actually paint a stroke of `size` with at the current zoom.
 *
 * Like {@link useLodDetail} the selector yields a discrete value, so a shape
 * re-renders when the threshold is crossed rather than on every zoom frame.
 */
export function useLodDash(dash: StrokeDash, size: number): StrokeDash {
  return useCameraStore((s) =>
    dash !== 'solid' && isBelowPatternDetail(s.camera.z, size) ? 'solid' : dash,
  );
}

/**
 * Whether a stroke of `size` world units should be drawn as a uniform-width
 * stroked centerline instead of the freehand engine's variable-width outline.
 *
 * The variable-width outline is what makes ink look like ink, and it costs a
 * full offset-and-simplify pass per stroke plus a path with several points per
 * sample. Once the whole stroke is thinner on screen than the width variation
 * it is carrying, none of that survives rasterization — so below the threshold
 * the centerline is handed to the GPU's own stroker instead, which is an
 * order of magnitude cheaper on a board holding thousands of strokes.
 *
 * The threshold is {@link isBelowPatternDetail}'s, and for the same reason: a
 * pattern and a width profile are both sub-pixel detail, and both stop reading
 * exactly when the stroke is at once far away and finer than a pixel and a
 * half. Like the other LOD selectors this yields a discrete boolean, so a
 * shape re-renders when the threshold is crossed rather than on every zoom
 * frame.
 */
export function useForceSolidInk(size: number): boolean {
  return useCameraStore((s) => isBelowPatternDetail(s.camera.z, size));
}
