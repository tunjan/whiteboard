import { create } from 'zustand';
import {
  type Camera,
  type Point,
  clampZoom,
  DEFAULT_CAMERA,
  zoomCameraAtScreen,
  zoomCameraAtScreenWithPan,
} from './camera';
import type { Bounds } from './geometry';

interface CameraStore {
  /** Live camera for the active board+page. */
  camera: Camera;
  /** Saved cameras, keyed by `${boardId}/${pageId}`. */
  cameras: Record<string, Camera>;
  /** Key of the active entry (the page `camera` belongs to). */
  activeKey: string;
  setCamera: (camera: Camera) => void;
  /** Pan by a delta expressed in screen pixels (converted to world units). */
  panByScreen: (dxScreen: number, dyScreen: number) => void;
  /** Zoom to `newZ` keeping the world point under `anchor` (screen px) fixed. */
  zoomAtScreen: (anchor: Point, newZ: number) => void;
  /** Zoom around `anchor` while the viewport content follows a screen drag. */
  zoomAtScreenWithPan: (
    anchor: Point,
    newZ: number,
    panDxScreen: number,
    panDyScreen: number,
  ) => void;
  /** Fit `bounds` into a `viewportW`x`viewportH` viewport with padding. */
  zoomToBounds: (
    bounds: Bounds,
    viewportW: number,
    viewportH: number,
    padding?: number,
  ) => void;
  /**
   * Switch the active camera to a board+page: persists the current page's
   * camera and restores (or defaults) the target page's camera.
   */
  switchTo: (boardId: string, pageId: string) => void;
  reset: () => void;
}

function cameraKey(boardId: string, pageId: string): string {
  return `${boardId}/${pageId}`;
}

const STORAGE_KEY = 'whiteboard:camera';

// Load the saved per-page cameras once at startup. Kept backward-compatible with
// the previous `persist` middleware format (`{ state: { cameras }, version }`).
function loadCameras(): Record<string, Camera> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as
      | { cameras?: Record<string, Camera>; state?: { cameras?: Record<string, Camera> } }
      | null;
    return parsed?.cameras ?? parsed?.state?.cameras ?? {};
  } catch {
    return {};
  }
}

function saveCameras(cameras: Record<string, Camera>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ cameras }));
  } catch {
    // Storage full/unavailable (private mode) — viewport memory is non-critical.
  }
}

// Per-user, local camera state. Persisted to localStorage so a reload keeps each
// page's viewport. Cameras are keyed per board+page so switching pages restores
// where you last were (like tldraw); viewport is never in the shared Yjs doc.
//
// The live `camera` is deliberately kept out of the per-frame write path: pan/zoom
// setters only replace `camera` (no `cameras` copy, no disk write). The saved
// `cameras` map is only written when leaving a page (`switchTo`) or when the tab is
// hidden/closed (see the `persistLiveCamera` listeners below), so a pan gesture
// costs no `JSON.stringify`/`localStorage.setItem` on the main thread.
export const useCameraStore = create<CameraStore>((set) => ({
  camera: DEFAULT_CAMERA,
  cameras: loadCameras(),
  activeKey: '',
  setCamera: (camera) => set({ camera }),
  panByScreen: (dx, dy) =>
    set((s) => ({
      camera: {
        ...s.camera,
        x: s.camera.x + dx / s.camera.z,
        y: s.camera.y + dy / s.camera.z,
      },
    })),
  zoomAtScreen: (anchor, newZ) =>
    set((s) => ({ camera: zoomCameraAtScreen(s.camera, anchor, newZ) })),
  zoomAtScreenWithPan: (anchor, newZ, panDxScreen, panDyScreen) =>
    set((s) => ({
      camera: zoomCameraAtScreenWithPan(s.camera, anchor, newZ, {
        x: panDxScreen,
        y: panDyScreen,
      }),
    })),
  zoomToBounds: (bounds, viewportW, viewportH, padding = 0.85) =>
    set(() => {
      const w = bounds.maxX - bounds.minX;
      const h = bounds.maxY - bounds.minY;
      if (w <= 0 || h <= 0 || viewportW <= 0 || viewportH <= 0) return {};
      const z = clampZoom(Math.min(viewportW / w, viewportH / h) * padding);
      const cx = (bounds.minX + bounds.maxX) / 2;
      const cy = (bounds.minY + bounds.maxY) / 2;
      return {
        camera: {
          x: cx - viewportW / (2 * z),
          y: cy - viewportH / (2 * z),
          z,
        },
      };
    }),
  switchTo: (boardId, pageId) =>
    set((s) => {
      const key = cameraKey(boardId, pageId);
      if (key === s.activeKey) return {};
      // Persist the camera we're leaving, then load the target's.
      const cameras = s.activeKey
        ? { ...s.cameras, [s.activeKey]: s.camera }
        : { ...s.cameras };
      saveCameras(cameras);
      return {
        cameras,
        activeKey: key,
        camera: cameras[key] ?? DEFAULT_CAMERA,
      };
    }),
  reset: () => set({ camera: DEFAULT_CAMERA }),
}));

// Flush the live camera into the saved map when the tab is backgrounded or
// closed. `pagehide` covers reload/navigation/close; `visibilitychange` covers
// mobile app-switching, where `pagehide` may not fire. Both are the only writes
// on the pan/zoom path, so the hot path never touches localStorage.
if (typeof window !== 'undefined') {
  const persistLiveCamera = () => {
    const { activeKey, camera, cameras } = useCameraStore.getState();
    if (activeKey) saveCameras({ ...cameras, [activeKey]: camera });
  };
  window.addEventListener('pagehide', persistLiveCamera);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') persistLiveCamera();
  });
}
