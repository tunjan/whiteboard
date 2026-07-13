import { create } from 'zustand';
import {
  DEFAULT_ANIMATION_PLAYBACK,
  type AnimationPlaybackState,
  type AnimationPlaybackStatus,
  type AnimationRecordingV1,
  type RecordedViewport,
  type RecordingMeta,
  type Shape,
} from '@whiteboard/shared';

/** Private, per-client playback transport — never written to the Yjs doc. */
export interface LocalPlaybackState {
  recordingId: string | null;
  status: AnimationPlaybackStatus;
  positionMs: number;
  updatedAt: number;
}

export const DEFAULT_LOCAL_PLAYBACK: LocalPlaybackState = {
  recordingId: null,
  status: 'stopped',
  positionMs: 0,
  updatedAt: 0,
};

interface AnimationStore {
  /** Server-side recordings library for the current board (metadata only). */
  library: RecordingMeta[];
  /** Fetched recording payloads by recording id (immutable once created). */
  payloads: Record<string, AnimationRecordingV1>;
  playback: AnimationPlaybackState;
  localPlayback: LocalPlaybackState;
  recordingPageId: string | null;
  recordingElapsedMs: number;
  recordingCountdown: number | null;
  playbackActive: boolean;
  /** True while the active playback session is a private local one. */
  isLocalPlayback: boolean;
  playbackPositionMs: number;
  playbackShapes: Shape[];
  playbackViewport: RecordedViewport | null;
  viewportSize: { width: number; height: number };
  setLibrary: (library: RecordingMeta[]) => void;
  addPayload: (id: string, recording: AnimationRecordingV1) => void;
  setPlayback: (playback: AnimationPlaybackState) => void;
  setLocalPlayback: (localPlayback: LocalPlaybackState) => void;
  setRecording: (pageId: string | null, elapsedMs?: number) => void;
  setRecordingElapsed: (recordingElapsedMs: number) => void;
  setRecordingCountdown: (recordingCountdown: number | null) => void;
  setPlaybackFrame: (frame: {
    active: boolean;
    local?: boolean;
    positionMs: number;
    shapes: Shape[];
    viewport: RecordedViewport | null;
  }) => void;
  setViewportSize: (viewportSize: { width: number; height: number }) => void;
  reset: () => void;
}

const INITIAL_STATE = {
  library: [],
  payloads: {},
  playback: DEFAULT_ANIMATION_PLAYBACK,
  localPlayback: DEFAULT_LOCAL_PLAYBACK,
  recordingPageId: null,
  recordingElapsedMs: 0,
  recordingCountdown: null,
  playbackActive: false,
  isLocalPlayback: false,
  playbackPositionMs: 0,
  playbackShapes: [],
  playbackViewport: null,
  viewportSize: { width: 0, height: 0 },
};

export const useAnimationStore = create<AnimationStore>((set) => ({
  ...INITIAL_STATE,
  setLibrary: (library) => set({ library }),
  addPayload: (id, recording) =>
    set((state) => ({ payloads: { ...state.payloads, [id]: recording } })),
  setPlayback: (playback) => set({ playback }),
  setLocalPlayback: (localPlayback) => set({ localPlayback }),
  setRecording: (recordingPageId, recordingElapsedMs = 0) =>
    set({ recordingPageId, recordingElapsedMs }),
  setRecordingElapsed: (recordingElapsedMs) => set({ recordingElapsedMs }),
  setRecordingCountdown: (recordingCountdown) => set({ recordingCountdown }),
  setPlaybackFrame: ({ active, local = false, positionMs, shapes, viewport }) =>
    set({
      playbackActive: active,
      isLocalPlayback: active && local,
      playbackPositionMs: positionMs,
      playbackShapes: shapes,
      playbackViewport: viewport,
    }),
  setViewportSize: (viewportSize) => set({ viewportSize }),
  reset: () => set(INITIAL_STATE),
}));

export function isAnimationPlaybackActive(): boolean {
  return useAnimationStore.getState().playbackActive;
}

export function isAnimationPageLocked(): boolean {
  const state = useAnimationStore.getState();
  return state.playbackActive || state.recordingPageId !== null;
}
