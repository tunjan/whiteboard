import { create } from 'zustand';
import {
  type Camera,
  type Point,
  clampZoom,
  DEFAULT_CAMERA,
  screenToWorld,
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
  /** Like {@link zoomAtScreen}, but eased over a short animation. */
  animateZoomAtScreen: (anchor: Point, newZ: number) => void;
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
  /** Like {@link zoomToBounds}, but eased over a short animation. */
  animateToBounds: (
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
  /** Forget the saved viewport for a page that no longer exists. */
  deletePage: (boardId: string, pageId: string) => void;
  reset: () => void;
}

function cameraKey(boardId: string, pageId: string): string {
  return `${boardId}/${pageId}`;
}

function constrainCamera(camera: Camera | undefined): Camera {
  if (!camera) return DEFAULT_CAMERA;
  return {
    x: Number.isFinite(camera.x) ? camera.x : DEFAULT_CAMERA.x,
    y: Number.isFinite(camera.y) ? camera.y : DEFAULT_CAMERA.y,
    z: clampZoom(Number.isFinite(camera.z) ? camera.z : DEFAULT_CAMERA.z),
  };
}

/** Camera that fits `bounds` centered in the viewport, or null if degenerate. */
function fitBoundsCamera(
  bounds: Bounds,
  viewportW: number,
  viewportH: number,
  padding: number,
): Camera | null {
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  if (w <= 0 || h <= 0 || viewportW <= 0 || viewportH <= 0) return null;
  const z = clampZoom(Math.min(viewportW / w, viewportH / h) * padding);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return { x: cx - viewportW / (2 * z), y: cy - viewportH / (2 * z), z };
}

// A button-driven zoom animates the camera towards its target instead of
// snapping. Zoom is interpolated geometrically (constant perceived rate) and the
// world point under `anchor` glides linearly, so the anchor stays put for a pure
// zoom and pans smoothly for zoom-to-fit. Any manual gesture cancels the tween.
const ZOOM_ANIM_MS = 280;
let animationFrame: number | null = null;

function cancelCameraAnimation(): void {
  if (animationFrame !== null) {
    cancelAnimationFrame(animationFrame);
    animationFrame = null;
  }
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function tweenCameraTo(
  set: (partial: { camera: Camera }) => void,
  from: Camera,
  target: Camera,
  anchor: Point,
): void {
  cancelCameraAnimation();
  const startWorld = screenToWorld(anchor, from);
  const endWorld = screenToWorld(anchor, target);
  const z0 = from.z;
  const z1 = target.z;
  const startTime = performance.now();
  const step = (nowMs: number) => {
    const e = easeInOutCubic(Math.min(1, (nowMs - startTime) / ZOOM_ANIM_MS));
    const z = z0 * (z1 / z0) ** e;
    const wx = startWorld.x + (endWorld.x - startWorld.x) * e;
    const wy = startWorld.y + (endWorld.y - startWorld.y) * e;
    set({ camera: { x: wx - anchor.x / z, y: wy - anchor.y / z, z } });
    animationFrame = e < 1 ? requestAnimationFrame(step) : null;
  };
  animationFrame = requestAnimationFrame(step);
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
export const useCameraStore = create<CameraStore>((set, get) => ({
  camera: DEFAULT_CAMERA,
  cameras: loadCameras(),
  activeKey: '',
  setCamera: (camera) => {
    cancelCameraAnimation();
    set({ camera });
  },
  panByScreen: (dx, dy) => {
    cancelCameraAnimation();
    set((s) => ({
      camera: {
        ...s.camera,
        x: s.camera.x + dx / s.camera.z,
        y: s.camera.y + dy / s.camera.z,
      },
    }));
  },
  zoomAtScreen: (anchor, newZ) => {
    cancelCameraAnimation();
    set((s) => ({ camera: zoomCameraAtScreen(s.camera, anchor, newZ) }));
  },
  animateZoomAtScreen: (anchor, newZ) => {
    const from = get().camera;
    tweenCameraTo(set, from, zoomCameraAtScreen(from, anchor, newZ), anchor);
  },
  zoomAtScreenWithPan: (anchor, newZ, panDxScreen, panDyScreen) => {
    cancelCameraAnimation();
    set((s) => ({
      camera: zoomCameraAtScreenWithPan(s.camera, anchor, newZ, {
        x: panDxScreen,
        y: panDyScreen,
      }),
    }));
  },
  zoomToBounds: (bounds, viewportW, viewportH, padding = 0.85) => {
    cancelCameraAnimation();
    const camera = fitBoundsCamera(bounds, viewportW, viewportH, padding);
    if (camera) set({ camera });
  },
  animateToBounds: (bounds, viewportW, viewportH, padding = 0.85) => {
    const camera = fitBoundsCamera(bounds, viewportW, viewportH, padding);
    if (camera) {
      tweenCameraTo(set, get().camera, camera, {
        x: viewportW / 2,
        y: viewportH / 2,
      });
    }
  },
  switchTo: (boardId, pageId) => {
    cancelCameraAnimation();
    return set((s) => {
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
        camera: constrainCamera(cameras[key]),
      };
    });
  },
  deletePage: (boardId, pageId) => {
    cancelCameraAnimation();
    set((s) => {
      const key = cameraKey(boardId, pageId);
      if (!(key in s.cameras) && key !== s.activeKey) return {};
      const cameras = { ...s.cameras };
      delete cameras[key];
      saveCameras(cameras);
      return key === s.activeKey
        ? { cameras, activeKey: '', camera: DEFAULT_CAMERA }
        : { cameras };
    });
  },
  reset: () => {
    cancelCameraAnimation();
    set({ camera: DEFAULT_CAMERA });
  },
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
