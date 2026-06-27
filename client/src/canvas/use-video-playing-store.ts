import { create } from 'zustand';

interface VideoPlayingStore {
  /** Id of the video shape currently playing inline, or null. */
  playingId: string | null;
  start: (id: string) => void;
  stop: () => void;
}

export const useVideoPlayingStore = create<VideoPlayingStore>((set) => ({
  playingId: null,
  start: (playingId) => set({ playingId }),
  stop: () => set({ playingId: null }),
}));
