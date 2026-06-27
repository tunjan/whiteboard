import { create } from 'zustand';

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
