import { create } from 'zustand';
import { cameraToTransform, type Camera } from './camera';
import { useCameraStore } from './use-camera-store';

// How long after the last camera change we keep treating the camera as "moving".
// One trackpad/wheel gesture fires many camera updates a few ms apart, so this
// bridges the gaps and clears shortly after the gesture settles.
const IDLE_MS = 140;

interface CameraInteractionStore {
  /** True while the camera is actively panning/zooming (debounced). */
  isMoving: boolean;
  /** True only while the selected Hand tool owns a pointer drag. */
  isHandDragging: boolean;
}

// Transient, derived signal — never persisted. Drives the pointer-event blocker
// that the canvas drops over the shapes during camera movement so the browser
// stops hit-testing the SVG shape tree on every frame.
export const useCameraInteraction = create<CameraInteractionStore>(() => ({
  isMoving: false,
  isHandDragging: false,
}));

/**
 * The world-space transform every camera-following layer shares, with
 * device-pixel snapping applied only once the camera has settled.
 *
 * Snapping is a quantizer (see {@link cameraTranslation}): worth it at rest for
 * crisp edges, visible as stepping while moving. `isMoving` is already the
 * debounced signal for exactly that window, and routing every layer through one
 * hook is what keeps them from disagreeing about where the world is mid-gesture
 * — half the layers snapped and half not would show up as overlays drifting
 * against their shapes by up to half a device pixel, every frame.
 */
export function useCameraTransform(camera: Camera): string {
  const isMoving = useCameraInteraction((s) => s.isMoving);
  return cameraToTransform(camera, !isMoving);
}

/** Publish the Hand tool's press state for the canvas cursor and toolbar icon. */
export function setHandDragging(isHandDragging: boolean): void {
  if (useCameraInteraction.getState().isHandDragging === isHandDragging) return;
  useCameraInteraction.setState({ isHandDragging });
}

// A single subscription to the camera store covers every movement source (wheel,
// trackpad pinch, Safari gestures, space-pan, keyboard zoom, follow/summon): they
// all replace the `camera` object via the store's setters.
let idleTimer: ReturnType<typeof setTimeout> | undefined;
useCameraStore.subscribe((state, prev) => {
  if (state.camera === prev.camera) return; // ignore non-camera store changes
  if (!useCameraInteraction.getState().isMoving) {
    useCameraInteraction.setState({ isMoving: true });
  }
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    useCameraInteraction.setState({ isMoving: false });
  }, IDLE_MS);
});
