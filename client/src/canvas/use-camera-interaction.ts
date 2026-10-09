import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { create } from 'zustand';
import { cameraTranslation, type Camera } from './camera';
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
 * How an overlay follows the camera without re-rendering on a pan — the same
 * split tldraw makes between its transformed layers and the React inside them.
 *
 * The overlay renders against the returned camera, which carries the live zoom
 * but sits at the world origin, so its `worldToScreen` output depends on zoom
 * alone. The element given the returned ref is then translated to the real
 * camera from a store listener, inside the same `setCamera` call that moves the
 * shape layer. A pan is one attribute write; React sees only zoom changes.
 *
 * The listener runs before React has re-rendered at a new zoom, so it scales by
 * live/rendered zoom: the overlay lands where it belongs for the frames in
 * between, stretched slightly, and the commit at the new zoom resets the scale.
 *
 * Device-pixel snapping follows the settle signal exactly as the shape layer's
 * does (see {@link cameraTranslation}), and both read the same `isMoving`, so an
 * overlay can never drift against its shapes mid-gesture.
 *
 * The ref goes on an SVG `<g>` inside the overlay's `<svg>` (an `<svg>` clips to
 * its own box, so translating the element itself would cut off content drawn
 * far from the origin), or on an HTML wrapper. A transformed HTML wrapper is a
 * stacking context, so it has to carry the z-index its content used to.
 */
export function useCameraFollow<T extends HTMLElement | SVGGElement>(): [
  Camera,
  (element: T | null) => void,
] {
  const z = useCameraStore((s) => s.camera.z);
  const camera = useMemo(() => ({ x: 0, y: 0, z }), [z]);
  const element = useRef<T | null>(null);
  const renderedZ = useRef(z);

  useLayoutEffect(() => {
    renderedZ.current = z;
    if (element.current) followCamera(element.current, z);
  }, [z]);

  useLayoutEffect(() => {
    const apply = () => {
      if (element.current) followCamera(element.current, renderedZ.current);
    };
    const stopCamera = useCameraStore.subscribe((next, prev) => {
      if (next.camera !== prev.camera) apply();
    });
    const stopSettle = useCameraInteraction.subscribe((next, prev) => {
      if (next.isMoving !== prev.isMoving) apply();
    });
    return () => {
      stopCamera();
      stopSettle();
    };
  }, []);

  const ref = useCallback((next: T | null) => {
    element.current = next;
    if (next) followCamera(next, renderedZ.current);
  }, []);

  return [camera, ref];
}

/**
 * For screen-space UI whose placement depends on where the camera is, not only
 * on its zoom — anything clamped to the window or pinned to its edge — and so
 * cannot ride a {@link useCameraFollow} wrapper.
 *
 * `place` writes the element's position directly: from a camera listener, and
 * after every render (so it may close over render state; the latest `place` is
 * the one called). A pan moves the element without re-rendering it. React must
 * not also be given whatever `place` writes, or a re-render would put back the
 * value it last rendered.
 */
export function useCameraPlacement<T extends HTMLElement>(
  place: (element: T, camera: Camera) => void,
): (element: T | null) => void {
  const latest = useRef(place);
  const element = useRef<T | null>(null);
  const apply = useCallback(() => {
    if (element.current)
      latest.current(element.current, useCameraStore.getState().camera);
  }, []);

  useLayoutEffect(() => {
    latest.current = place;
    apply();
  });

  useLayoutEffect(
    () =>
      useCameraStore.subscribe((next, prev) => {
        if (next.camera !== prev.camera) apply();
      }),
    [apply],
  );

  return useCallback(
    (next: T | null) => {
      element.current = next;
      if (next) apply();
    },
    [apply],
  );
}

function followCamera(element: HTMLElement | SVGGElement, renderedZ: number) {
  const camera = useCameraStore.getState().camera;
  const { e, f } = cameraTranslation(
    camera,
    !useCameraInteraction.getState().isMoving,
  );
  const scale = camera.z / renderedZ;
  if (element instanceof SVGElement) {
    element.setAttribute(
      'transform',
      scale === 1 ? `translate(${e} ${f})` : `translate(${e} ${f}) scale(${scale})`,
    );
    return;
  }
  element.style.transformOrigin = '0 0';
  element.style.transform =
    scale === 1
      ? `translate(${e}px, ${f}px)`
      : `translate(${e}px, ${f}px) scale(${scale})`;
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

// The corner chrome's glass drops its backdrop blur while this is set (index.css
// section 8): a moving backdrop is the one case where the blur costs per frame.
// Written twice per gesture, and only rules naming it are invalidated.
useCameraInteraction.subscribe((state, prev) => {
  if (state.isMoving === prev.isMoving || typeof document === 'undefined') return;
  document.documentElement.toggleAttribute('data-camera-moving', state.isMoving);
});
