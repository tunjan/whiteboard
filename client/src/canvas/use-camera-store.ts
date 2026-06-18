import { create } from 'zustand';
import { persist } from 'zustand/middleware';
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

// Per-user, local camera state. Persisted to localStorage so a reload keeps each
// page's viewport. Cameras are keyed per board+page so switching pages restores
// where you last were (like tldraw); viewport is never in the shared Yjs doc.
export const useCameraStore = create<CameraStore>()(
  persist(
    (set) => ({
      camera: DEFAULT_CAMERA,
      cameras: {},
      activeKey: '',
      setCamera: (camera) =>
        set((s) => ({
          camera,
          cameras: s.activeKey
            ? { ...s.cameras, [s.activeKey]: camera }
            : s.cameras,
        })),
      panByScreen: (dx, dy) =>
        set((s) => {
          const camera = {
            ...s.camera,
            x: s.camera.x + dx / s.camera.z,
            y: s.camera.y + dy / s.camera.z,
          };
          return {
            camera,
            cameras: s.activeKey
              ? { ...s.cameras, [s.activeKey]: camera }
              : s.cameras,
          };
        }),
      zoomAtScreen: (anchor, newZ) =>
        set((s) => {
          const camera = zoomCameraAtScreen(s.camera, anchor, newZ);
          return {
            camera,
            cameras: s.activeKey
              ? { ...s.cameras, [s.activeKey]: camera }
              : s.cameras,
          };
        }),
      zoomAtScreenWithPan: (anchor, newZ, panDxScreen, panDyScreen) =>
        set((s) => {
          const camera = zoomCameraAtScreenWithPan(s.camera, anchor, newZ, {
            x: panDxScreen,
            y: panDyScreen,
          });
          return {
            camera,
            cameras: s.activeKey
              ? { ...s.cameras, [s.activeKey]: camera }
              : s.cameras,
          };
        }),
      zoomToBounds: (bounds, viewportW, viewportH, padding = 0.85) =>
        set((s) => {
          const w = bounds.maxX - bounds.minX;
          const h = bounds.maxY - bounds.minY;
          if (w <= 0 || h <= 0 || viewportW <= 0 || viewportH <= 0) return {};
          const z = clampZoom(Math.min(viewportW / w, viewportH / h) * padding);
          const cx = (bounds.minX + bounds.maxX) / 2;
          const cy = (bounds.minY + bounds.maxY) / 2;
          const camera = {
            x: cx - viewportW / (2 * z),
            y: cy - viewportH / (2 * z),
            z,
          };
          return {
            camera,
            cameras: s.activeKey
              ? { ...s.cameras, [s.activeKey]: camera }
              : s.cameras,
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
          return {
            cameras,
            activeKey: key,
            camera: cameras[key] ?? DEFAULT_CAMERA,
          };
        }),
      reset: () =>
        set((s) => ({
          camera: DEFAULT_CAMERA,
          cameras: s.activeKey
            ? { ...s.cameras, [s.activeKey]: DEFAULT_CAMERA }
            : s.cameras,
        })),
    }),
    { name: 'whiteboard:camera' },
  ),
);
