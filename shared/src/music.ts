export interface MusicTrack {
  id: string;
  title: string;
  artist?: string;
  playlist: string;
  url: string;
}

export interface MusicPlaylist {
  name: string;
  tracks: MusicTrack[];
}

export interface MusicLibraryResponse {
  playlists: MusicPlaylist[];
}

export type MusicPlaybackStatus = 'stopped' | 'playing' | 'paused';

export interface MusicPlaybackState {
  trackId: string | null;
  status: MusicPlaybackStatus;
  /**
   * Seconds into the track when `updatedAt` was written. Playing clients derive
   * the current target position by adding elapsed wall-clock time.
   */
  position: number;
  updatedAt: number;
  version: number;
  requestedBy?: string;
}

export const DEFAULT_MUSIC_PLAYBACK: MusicPlaybackState = {
  trackId: null,
  status: 'stopped',
  position: 0,
  updatedAt: 0,
  version: 0,
};
