import type { StrokeDash } from '@whiteboard/shared';
import { patternCutoff, useLodStore } from './use-lod-store';

export type LodDetail = 'high' | 'low';

/**
 * Level-of-detail for the current zoom. Returns `'low'` once zoomed out past
 * the threshold in {@link useLodStore}, where expensive effects (drop shadows)
 * become sub-pixel and not worth compositing. The store publishes a discrete
 * string, so consumers re-render when the threshold is crossed — never per
 * frame, and never on a pan.
 */
export function useLodDetail(): LodDetail {
  return useLodStore((s) => s.detail);
}

/**
 * Length to give the dots of a dotted stroke, in world units.
 *
 * A dot is normally a zero-length dash relying on the round linecap to paint
 * it, which costs nothing and stays perfectly circular. Zoomed far enough out
 * that cap is sub-pixel and browsers drop it, taking the whole stroke with it;
 * below the threshold the dashes are given real length instead so something
 * still reads on screen. Like {@link useLodDetail} the store publishes a
 * discrete value, so shapes re-render only when the threshold is crossed.
 */
export function useDotLength(): number {
  return useLodStore((s) => s.dotLength);
}

/**
 * Whether a stroke of `size` world units is too fine at `zoom` to carry a
 * pattern.
 *
 * Both terms are needed, and {@link patternCutoff} carries both. The width test
 * alone would flatten a hairline stroke that is being examined up close, where
 * its dashes are exactly the detail the user zoomed in for; the zoom test alone
 * would flatten a thick stroke seen from far out, whose dashes are still
 * several pixels apart and perfectly legible. A pattern is dropped only when
 * the stroke is both far away and sub-pixel on screen — the case where its gaps
 * fall between device pixels and the anti-aliased remainder reads as a dotted,
 * flickering line rather than as the dashed one it is.
 *
 * Callers that already hold the published cutoff — the hooks below — compare
 * against it directly; this is for the ones that hold a camera instead. Both
 * routes must keep going through `patternCutoff`, or the two disagree about
 * which strokes are patterned at a given zoom.
 */
export function isBelowPatternDetail(zoom: number, size: number): boolean {
  return size < patternCutoff(zoom);
}

/**
 * The dash style to actually paint a stroke of `size` with at the current zoom.
 *
 * Like {@link useLodDetail} the selector yields a discrete value, so a shape
 * re-renders when the threshold is crossed rather than on every zoom frame.
 */
export function useLodDash(dash: StrokeDash, size: number): StrokeDash {
  return useLodStore((s) =>
    dash !== 'solid' && size < s.patternCutoff ? 'solid' : dash,
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
  return useLodStore((s) => size < s.patternCutoff);
}

/**
 * Perpendicular error, in world units, this shape's ink path may carry at the
 * current zoom.
 *
 * Handed to the ink engine, which already drops outline points that stay
 * inside a brush-relative bound; this raises that bound to whatever is
 * sub-pixel on screen. Like the other LOD selectors the store publishes a
 * discrete value — one per zoom octave — so a shape re-renders when a band is
 * crossed rather than on every zoom frame. See `inkErrorLimit`.
 */
export function useInkErrorLimit(): number {
  return useLodStore((s) => s.inkErrorLimit);
}
