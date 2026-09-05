import { useEffect, type RefObject } from 'react';
import { noteActivity } from '@/collab/attention';
import { stopFollowingForManualCameraChange } from '@/collab/use-follow-store';
import type { Point } from './camera';
import { useCameraStore } from './use-camera-store';

// Rough px-per-line for wheel events reported in line units (mouse wheels).
const LINE_HEIGHT = 16;
// Rough px-per-page for wheel events reported in page units.
const PAGE_HEIGHT = 800;
const WHEEL_ZOOM_SPEED = 1;
// Bound a single event's zoom delta so one notch can't jump wildly.
const MAX_ZOOM_DELTA = 10;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * A wheel event's deltas in CSS pixels.
 *
 * `deltaMode` is not a hint: an event reporting lines or pages carries numbers
 * on a completely different scale (a page-mode notch is ~1, not ~100), so
 * reading `deltaY` without converting pans by a few pixels where the user asked
 * for a screenful. Firefox on Linux is the common source of line mode; page
 * mode is rare but costs one branch to honour.
 */
export function normalizeWheelDelta(event: {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
}): Point {
  const scale =
    event.deltaMode === 1 ? LINE_HEIGHT : event.deltaMode === 2 ? PAGE_HEIGHT : 1;
  return { x: event.deltaX * scale, y: event.deltaY * scale };
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
 *
 * Events are accumulated and committed once per frame. Trackpads and momentum
 * scrolling burst well above the refresh rate, and the old shape of this
 * handler paid, per raw event, a `getBoundingClientRect()` (a layout read
 * interleaved with camera writes) plus a store commit and the React render
 * behind it. Nothing was gained: several commits within one frame only ever
 * showed the last one. Accumulating is exact rather than approximate — pan
 * deltas add, and successive zooms about one anchor compose multiplicatively.
 */
export function useWheel(
  ref: RefObject<HTMLElement | null>,
  disabled = false,
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let frame: number | null = null;
    let panX = 0;
    let panY = 0;
    let zoomFactor = 1;
    // The zoom anchor is the newest pointer position; within a frame it moves
    // at most a pixel or two, so pinning the accumulated zoom to it is what the
    // last event of the burst would have done anyway.
    let anchorClientX = 0;
    let anchorClientY = 0;

    const flush = () => {
      frame = null;
      const rect = el.getBoundingClientRect();
      const store = useCameraStore.getState();

      if (panX !== 0 || panY !== 0) {
        store.panByScreen(panX, panY);
        panX = 0;
        panY = 0;
      }
      if (zoomFactor !== 1) {
        // Re-read the camera: `panByScreen` above has already replaced it.
        const { z } = useCameraStore.getState().camera;
        store.zoomAtScreen(
          { x: anchorClientX - rect.left, y: anchorClientY - rect.top },
          z * zoomFactor,
        );
        zoomFactor = 1;
      }
    };

    const onWheel = (e: WheelEvent) => {
      // Must stay synchronous — the browser would otherwise scroll or zoom the
      // page out from under the canvas.
      e.preventDefault();
      if (disabled) return;
      noteActivity();
      stopFollowingForManualCameraChange();

      anchorClientX = e.clientX;
      anchorClientY = e.clientY;

      const delta = normalizeWheelDelta(e);
      if (e.ctrlKey || e.metaKey) {
        const zoomDelta =
          -clamp(delta.y, -MAX_ZOOM_DELTA, MAX_ZOOM_DELTA) / 100;
        zoomFactor *= 1 + zoomDelta * WHEEL_ZOOM_SPEED;
      } else {
        panX += delta.x;
        panY += delta.y;
      }

      if (frame === null) frame = requestAnimationFrame(flush);
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [ref, disabled]);
}
