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
