import { useEffect, type RefObject } from 'react';
import { stopFollowingForManualCameraChange } from '@/collab/use-follow-store';
import { useCameraStore } from './use-camera-store';

// Rough px-per-line for wheel events reported in line units (mouse wheels).
const LINE_HEIGHT = 16;
const WHEEL_ZOOM_SPEED = 1;
// Bound a single event's zoom delta so one notch can't jump wildly.
const MAX_ZOOM_DELTA = 10;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * Wheel handling, registered **non-passive** so we can `preventDefault()` and
 * stop the page from scrolling/zooming instead of the canvas.
 *
 * - Ctrl/Cmd + wheel, and trackpad pinch (which the browser delivers as a
 *   `wheel` event with `ctrlKey` set) → zoom-to-cursor.
 * - Otherwise → pan (two-finger trackpad scroll / mouse wheel).
 *
 * Safari delivers trackpad pinch as `gesture*` events instead — see
 * `useSafariGestures`.
 */
export function useWheel(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      stopFollowingForManualCameraChange();
      const rect = el.getBoundingClientRect();
      const anchor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const store = useCameraStore.getState();

      if (e.ctrlKey || e.metaKey) {
        const lineScale = e.deltaMode === 1 ? LINE_HEIGHT : 1;
        const delta = clamp(e.deltaY * lineScale, -MAX_ZOOM_DELTA, MAX_ZOOM_DELTA);
        const zoomDelta = -delta / 100;
        store.zoomAtScreen(
          anchor,
          store.camera.z * (1 + zoomDelta * WHEEL_ZOOM_SPEED),
        );
        return;
      }

      const scale = e.deltaMode === 1 ? LINE_HEIGHT : 1;
      store.panByScreen(e.deltaX * scale, e.deltaY * scale);
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [ref]);
}
