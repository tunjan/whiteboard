import type { VideoKind } from '@whiteboard/shared';
import { create } from 'zustand';

/**
 * How much of the board the call panel covers. `bar` keeps only the header, so
 * a call can stay joined without taking space away from the canvas.
 */
export type VideoPanelMode = 'bar' | 'floating' | 'maximized';

/**
 * Your own camera is the least useful thing on screen — in a one-to-one call a
 * full tile for it halves the space given to the person you are talking to. So
 * it rides as a thumbnail, or not at all.
 */
export type SelfView = 'pip' | 'hidden';

export interface PanelPosition {
  x: number;
  y: number;
}

interface VideoStore {
  selfView: SelfView;
  cameraEnabled: boolean;
  screenEnabled: boolean;
  error: string | null;
  localCamera: MediaStream | null;
  localScreen: MediaStream | null;
  remoteCameras: Map<number, MediaStream>;
  remoteScreens: Map<number, MediaStream>;
  mode: VideoPanelMode;
  /** Null until the panel is dragged; the panel is edge-anchored until then. */
  position: PanelPosition | null;
  spotlightKey: string | null;
  setSelfView: (selfView: SelfView) => void;
  setCameraEnabled: (enabled: boolean) => void;
  setScreenEnabled: (enabled: boolean) => void;
  setError: (error: string | null) => void;
  setLocalVideo: (kind: VideoKind, stream: MediaStream | null) => void;
  setRemoteVideo: (
    clientId: number,
    kind: VideoKind,
    stream: MediaStream | null,
  ) => void;
  setMode: (mode: VideoPanelMode) => void;
  setPosition: (position: PanelPosition | null) => void;
  setSpotlightKey: (key: string | null) => void;
  resetSession: () => void;
}

const SELF_VIEW_STORAGE_KEY = 'whiteboard:video-self-view';

function readStoredSelfView(): SelfView {
  if (typeof window === 'undefined') return 'pip';
  try {
    return window.localStorage.getItem(SELF_VIEW_STORAGE_KEY) === 'hidden'
      ? 'hidden'
      : 'pip';
  } catch {
    return 'pip';
  }
}

function storeSelfView(selfView: SelfView): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SELF_VIEW_STORAGE_KEY, selfView);
  } catch {
    // Storage can be unavailable in hardened contexts; the live choice stands.
  }
}

/**
 * Video lives in its own store rather than in `useVoiceStore` so a camera
 * toggle doesn't wake the voice popover or the audio sinks, which subscribe to
 * every field of that store.
 */
export const useVideoStore = create<VideoStore>((set) => ({
  // A display preference, so it outlives the call and is not in `resetSession`.
  selfView: readStoredSelfView(),
  cameraEnabled: false,
  screenEnabled: false,
  error: null,
  localCamera: null,
  localScreen: null,
  remoteCameras: new Map(),
  remoteScreens: new Map(),
  mode: 'floating',
  position: null,
  spotlightKey: null,
  setSelfView: (selfView) => {
    storeSelfView(selfView);
    set({ selfView });
  },
  setCameraEnabled: (cameraEnabled) => set({ cameraEnabled }),
  setScreenEnabled: (screenEnabled) => set({ screenEnabled }),
  setError: (error) => set({ error }),
  setLocalVideo: (kind, stream) =>
    set(kind === 'camera' ? { localCamera: stream } : { localScreen: stream }),
  setRemoteVideo: (clientId, kind, stream) =>
    set((state) => {
      const current =
        kind === 'camera' ? state.remoteCameras : state.remoteScreens;
      // Identity-preserving, like `setRemote` in the voice store: a no-op write
      // must not hand React a new Map, or every <video> rebinds its srcObject.
      if (
        (stream && current.get(clientId) === stream) ||
        (!stream && !current.has(clientId))
      ) {
        return state;
      }
      const next = new Map(current);
      if (stream) next.set(clientId, stream);
      else next.delete(clientId);
      return kind === 'camera'
        ? { remoteCameras: next }
        : { remoteScreens: next };
    }),
  setMode: (mode) => set(mode === 'maximized' ? { mode } : { mode, spotlightKey: null }),
  setPosition: (position) => set({ position }),
  setSpotlightKey: (spotlightKey) => set({ spotlightKey }),
  resetSession: () =>
    set({
      cameraEnabled: false,
      screenEnabled: false,
      error: null,
      localCamera: null,
      localScreen: null,
      remoteCameras: new Map(),
      remoteScreens: new Map(),
      mode: 'floating',
      position: null,
      spotlightKey: null,
    }),
}));
