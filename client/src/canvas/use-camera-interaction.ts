import { create } from 'zustand';
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
