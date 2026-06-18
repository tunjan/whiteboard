import { create } from 'zustand';
import {
  DEFAULT_MUSIC_PLAYBACK,
  type MusicPlaybackState,
} from '@whiteboard/shared';

interface MusicPlaybackStore {
  playback: MusicPlaybackState;
  setPlayback: (playback: MusicPlaybackState) => void;
  reset: () => void;
}

export const useMusicPlaybackStore = create<MusicPlaybackStore>((set) => ({
  playback: DEFAULT_MUSIC_PLAYBACK,
  setPlayback: (playback) => set({ playback }),
  reset: () => set({ playback: DEFAULT_MUSIC_PLAYBACK }),
}));
