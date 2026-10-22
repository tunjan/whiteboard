import { useEffect } from 'react';
import { create } from 'zustand';
import { useShape } from './use-shapes';

interface ImageCroppingStore {
  /** Id of the image shape currently being cropped, or null. */
  croppingId: string | null;
  start: (id: string) => void;
  stop: () => void;
}

export const useImageCroppingStore = create<ImageCroppingStore>((set) => ({
  croppingId: null,
  start: (croppingId) => set({ croppingId }),
  stop: () => set({ croppingId: null }),
}));

/**
 * Leave crop mode once the shape being cropped is gone, deleted here or by a
 * peer. Otherwise undoing the delete brought the image back already cropping.
 */
export function useEndCropWhenGone(): void {
  const croppingId = useImageCroppingStore((s) => s.croppingId);
  const shape = useShape(croppingId);
  useEffect(() => {
    if (croppingId && !shape) useImageCroppingStore.getState().stop();
  }, [croppingId, shape]);
}
