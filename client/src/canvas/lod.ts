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
