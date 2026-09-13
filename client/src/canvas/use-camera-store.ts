import { create } from 'zustand';
import {
  type Camera,
  type Point,
  clampZoom,
  DEFAULT_CAMERA,
  interpolateCameraViewport,
  zoomCameraAtScreen,
  zoomCameraAtScreenWithPan,
} from './camera';
import { beginCameraSlide, stepCameraSlide } from './camera-slide';
import type { Bounds } from './geometry';
import { cameraFitZoom, constrainCamera, type CameraConstraints, type CameraViewport } from './camera-constraints';

interface CameraStore {
  /** Live camera for the active board+page. */
  camera: Camera;
  /** Saved cameras, keyed by `${boardId}/${pageId}`. */
  cameras: Record<string, Camera>;
  /** Key of the active entry (the page `camera` belongs to). */
  activeKey: string;
  setCamera: (camera: Camera) => void;
  stopCameraAnimation: () => void;
  constraints: CameraConstraints | null;
  viewport: CameraViewport;
  baseZoom: number;
  setConstraints: (constraints: CameraConstraints | null) => void;
  setViewportSize: (width: number, height: number) => void;
  /** Pan by a delta expressed in screen pixels (converted to world units). */
  panByScreen: (dxScreen: number, dyScreen: number) => void;
  /**
   * Coast the camera to a stop from a release velocity in screen px/ms (the
   * pointer's, not the camera's — the camera travels the other way), and
   * optionally a zoom rate in ln-zoom units per ms (a pinch lifted mid-scale).
   * The zoom half coasts about the viewport's centre, the only anchor still
   * meaningful once the fingers that set one are off the glass. Ignored for a
   * release too slow to read as a throw.
   */
  slideCamera: (velocity: Point, zoomRate?: number) => void;
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
  /**
   * Put `center` (world) at the middle of the viewport, leaving zoom alone
   * unless `zoom` is given (clamped like any other requested scale).
   *
   * Separate from {@link zoomToBounds} because the minimap pans without ever
   * changing scale, and deriving that from a fit would recompute the zoom it
   * already has — landing a rounding error off it on every drag frame.
   */
  centerOn: (center: Point, zoom?: number) => void;
  /** Like {@link centerOn}, but eased over a short animation. */
  animateCenterOn: (center: Point, zoom?: number) => void;
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
  /** Seed a new page's viewport from another page's (used by page duplication). */
  copyPage: (boardId: string, fromPageId: string, toPageId: string) => void;
  /** Forget the saved viewport for a page that no longer exists. */
  deletePage: (boardId: string, pageId: string) => void;
  reset: () => void;
}

function cameraKey(boardId: string, pageId: string): string {
  return `${boardId}/${pageId}`;
}

/** Camera that fits `bounds` centered in the viewport, or null if degenerate. */
function fitBoundsCamera(
  bounds: Bounds,
  viewportW: number,
  viewportH: number,
  padding: number,
  limitZoom: (zoom: number) => number = clampZoom,
): Camera | null {
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  if (![w, h, bounds.minX, bounds.minY, viewportW, viewportH, padding].every(Number.isFinite) ||
      w <= 0 || h <= 0 || viewportW <= 0 || viewportH <= 0 || padding <= 0) return null;
  const z = limitZoom(Math.min(viewportW / w, viewportH / h) * padding);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return { x: cx - viewportW / (2 * z), y: cy - viewportH / (2 * z), z };
}

/**
 * A requested scale put through the same clamp a `setCamera` would apply, so a
 * framing computed from it lands where the camera actually ends up. `undefined`
 * means "leave the zoom alone" and passes straight through.
 */
function limitZoom(
  resolve: (camera: Camera, preserveFocalPoint?: boolean) => Camera,
  camera: Camera,
  zoom: number | undefined,
): number | undefined {
  return zoom === undefined ? undefined : resolve({ ...camera, z: zoom }, false).z;
}

/**
 * Camera showing `center` at the viewport's middle, or null if unmeasurable.
 *
 * `zoom` must already be clamped by the caller: the half-viewport offsets are
 * computed from it, so centering against a scale the constraints would go on to
 * reject would leave the point off-center by the difference.
 */
function centeredCamera(
  center: Point,
  state: { camera: Camera; viewport: CameraViewport },
  zoom = state.camera.z,
): Camera | null {
  const { viewport } = state;
  if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) return null;
  if (!(viewport.width > 0 && viewport.height > 0)) return null;
  if (!(Number.isFinite(zoom) && zoom > 0)) return null;
  return {
    x: center.x - viewport.width / (2 * zoom),
    y: center.y - viewport.height / (2 * zoom),
    z: zoom,
  };
}

// Interpolate the visible page rectangle so simultaneous pan and zoom follow
// one spatial trajectory. Manual input cancels both this tween and momentum.
const ZOOM_ANIM_MS = 280;
let animationFrame: number | null = null;
// The inertial coast runs on its own handle: it drives the camera through the
// same `set` as everything else, so sharing a handle with the zoom tween would
// have it cancel itself on its first frame.
let slideFrame: number | null = null;

function cancelCameraAnimation(): void {
  if (animationFrame !== null) {
    cancelAnimationFrame(animationFrame);
    animationFrame = null;
  }
  if (slideFrame !== null) {
    cancelAnimationFrame(slideFrame);
    slideFrame = null;
  }
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function tweenCameraTo(
  commit: (camera: Camera) => void,
  from: Camera,
  target: Camera,
): void {
  cancelCameraAnimation();
  if (prefersReducedMotion()) {
    commit(target);
    return;
  }
  const startTime = performance.now();
  const step = (nowMs: number) => {
    const e = easeInOutCubic(Math.min(1, (nowMs - startTime) / ZOOM_ANIM_MS));
    // Clear before publishing: a subscriber may interrupt the animation.
    animationFrame = e < 1 ? requestAnimationFrame(step) : null;
    commit(interpolateCameraViewport(from, target, e));
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
    const parsed = JSON.parse(raw) as {
      cameras?: Record<string, Camera>;
      state?: { cameras?: Record<string, Camera> };
    } | null;
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
export const useCameraStore = create<CameraStore>((set, get) => {
  const resolve = (camera: Camera, preserveFocalPoint = true) => {
    const s = get();
    return constrainCamera(camera, s.camera, s.constraints, s.viewport, preserveFocalPoint);
  };
  const commit = (requested: Camera) => {
    const camera = resolve(requested);
    const previous = get().camera;
    if (camera.x === previous.x && camera.y === previous.y && camera.z === previous.z) return;
    set({ camera });
  };
  return ({
  camera: DEFAULT_CAMERA,
  cameras: loadCameras(),
  activeKey: '',
  constraints: null,
  viewport: { width: 0, height: 0 },
  baseZoom: 1,
  stopCameraAnimation: cancelCameraAnimation,
  setConstraints: (constraints) => {
    cancelCameraAnimation();
    const { viewport, camera } = get();
    set({ constraints, baseZoom: cameraFitZoom(constraints, viewport, constraints?.baseZoom) });
    const z = constraints?.initialZoom ? cameraFitZoom(constraints, viewport, constraints.initialZoom) : camera.z;
    commit(resolve({ ...camera, z }, false));
  },
  setViewportSize: (width, height) => {
    if (!(Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0)) return;
    const s = get();
    if (s.viewport.width === width && s.viewport.height === height) return;
    cancelCameraAnimation();
    const viewport = { width, height };
    set({ viewport, baseZoom: cameraFitZoom(s.constraints, viewport, s.constraints?.baseZoom) });
    const z = !s.viewport.width && s.constraints?.initialZoom
      ? cameraFitZoom(s.constraints, viewport, s.constraints.initialZoom) : s.camera.z;
    commit(resolve({ ...s.camera, z }, false));
  },
  setCamera: (camera) => {
    cancelCameraAnimation();
    commit(camera);
  },
  panByScreen: (dx, dy) => {
    cancelCameraAnimation();
    const camera = get().camera;
    commit({ ...camera, x: camera.x + dx / camera.z, y: camera.y + dy / camera.z });
  },
  slideCamera: (velocity, zoomRate = 0) => {
    cancelCameraAnimation();
    if (prefersReducedMotion()) return;
    let slide = beginCameraSlide(velocity, zoomRate);
    if (!slide) return;
    let previous = performance.now();
    const step = (nowMs: number) => {
      const elapsed = nowMs - previous;
      previous = nowMs;
      const { dx, dy, zoomFactor, next } = stepCameraSlide(slide!, elapsed);
      const camera = get().camera;
      slide = next;
      slideFrame = next ? requestAnimationFrame(step) : null;
      const panned = { ...camera, x: camera.x - dx / camera.z, y: camera.y - dy / camera.z };
      const { viewport } = get();
      commit(
        zoomFactor === 1 || !(viewport.width > 0 && viewport.height > 0)
          ? panned
          : zoomCameraAtScreen(
              panned,
              { x: viewport.width / 2, y: viewport.height / 2 },
              panned.z * zoomFactor,
            ),
      );
      const after = get().camera;
      // Also the exit for a zoom coast that has run into the zoom limits.
      if (after.x === camera.x && after.y === camera.y && after.z === camera.z) {
        cancelCameraAnimation();
      }
    };
    slideFrame = requestAnimationFrame(step);
  },
  zoomAtScreen: (anchor, newZ) => {
    cancelCameraAnimation();
    commit(zoomCameraAtScreen(get().camera, anchor, newZ));
  },
  animateZoomAtScreen: (anchor, newZ) => {
    const from = get().camera;
    tweenCameraTo(commit, from, resolve(zoomCameraAtScreen(from, anchor, newZ)));
  },
  zoomAtScreenWithPan: (anchor, newZ, panDxScreen, panDyScreen) => {
    cancelCameraAnimation();
    const camera = get().camera;
    // Clamp scale before combining midpoint motion: limits must not attenuate pan.
    const z = resolve({ ...camera, z: newZ }).z;
    commit(zoomCameraAtScreenWithPan(camera, anchor, z, { x: panDxScreen, y: panDyScreen }));
  },
  centerOn: (center, zoom) => {
    cancelCameraAnimation();
    const s = get();
    const camera = centeredCamera(center, s, limitZoom(resolve, s.camera, zoom));
    if (camera) commit(resolve(camera, false));
  },
  animateCenterOn: (center, zoom) => {
    const s = get();
    const camera = centeredCamera(center, s, limitZoom(resolve, s.camera, zoom));
    if (camera) tweenCameraTo(commit, s.camera, resolve(camera, false));
  },
  zoomToBounds: (bounds, viewportW, viewportH, padding = 0.85) => {
    cancelCameraAnimation();
    const camera = fitBoundsCamera(bounds, viewportW, viewportH, padding, (z) => resolve({ ...get().camera, z }).z);
    if (camera) commit(resolve(camera, false));
  },
  animateToBounds: (bounds, viewportW, viewportH, padding = 0.85) => {
    const camera = fitBoundsCamera(bounds, viewportW, viewportH, padding, (z) => resolve({ ...get().camera, z }).z);
    if (camera) {
      tweenCameraTo(commit, get().camera, resolve(camera, false));
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
        camera: constrainCamera(cameras[key] ?? DEFAULT_CAMERA),
        constraints: null,
        baseZoom: 1,
      };
    });
  },
  copyPage: (boardId, fromPageId, toPageId) => {
    set((s) => {
      const fromKey = cameraKey(boardId, fromPageId);
      // The source page's live camera has not been flushed into `cameras` yet
      // while it is the active one.
      const source = fromKey === s.activeKey ? s.camera : s.cameras[fromKey];
      if (!source) return {};
      const cameras = { ...s.cameras, [cameraKey(boardId, toPageId)]: source };
      saveCameras(cameras);
      return { cameras };
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
    commit(resolve(DEFAULT_CAMERA, false));
  },
});
});

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
