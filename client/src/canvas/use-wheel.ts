import { useEffect, type RefObject } from 'react';
import { noteActivity } from '@/collab/attention';
import { stopFollowingForManualCameraChange } from '@/collab/use-follow-store';
import { zoomCameraAtScreen, type Camera, type Point } from './camera';
import { constrainCamera, type CameraConstraints, type CameraViewport } from './camera-constraints';
import { getContainerRect } from './container-rect';
import { isDarwin } from './platform';
import { useCameraStore } from './use-camera-store';
import { useCanvasUiStore } from './use-canvas-ui-store';

// Rough px-per-line for wheel events reported in line units (mouse wheels).
const LINE_HEIGHT = 16;
// Rough px-per-page for wheel events reported in page units.
const PAGE_HEIGHT = 800;
const WHEEL_ZOOM_SPEED = 1;
// Bound a single event's zoom delta so one notch can't jump wildly.
const MAX_ZOOM_DELTA = 10;

// Notch sizes a discrete mouse wheel reports one detent as, in CSS pixels.
const WHEEL_NOTCHES = [100, 120];
// Largest single pixel-mode delta still small enough to be a trackpad sample.
const TRACKPAD_MAX_DELTA = 40;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export type WheelPointerProfile = 'mouse' | 'trackpad' | 'unknown';

/**
 * Which kind of device emitted a wheel event, as far as its deltas can say.
 *
 * The browser never reports this, and it matters because the two devices want
 * opposite things from a scroll-direction preference: a wheel is a notched
 * control someone may well want reversed, while a trackpad's two-finger scroll
 * already follows the OS-wide natural-scrolling setting and its inertia tail
 * reads as broken when reversed underneath it. So the preference is applied
 * only to what this can positively identify as a wheel — `unknown` scrolls the
 * way the platform sent it.
 *
 * The evidence is the shape of the deltas: a wheel steps one axis at a time by
 * whole notches, a trackpad streams small, often fractional, often two-axis
 * samples.
 */
export function wheelPointerProfile(event: {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
}): WheelPointerProfile {
  // Line and page units are a wheel's; a trackpad reports pixels.
  if (event.deltaMode !== 0) return 'mouse';
  const x = Number.isFinite(event.deltaX) ? event.deltaX : 0;
  const y = Number.isFinite(event.deltaY) ? event.deltaY : 0;
  // Both axes moving at once is a surface under two fingers, not a detent.
  if (x !== 0 && y !== 0) return 'trackpad';
  if (!Number.isInteger(x) || !Number.isInteger(y)) return 'trackpad';
  const magnitude = Math.max(Math.abs(x), Math.abs(y));
  if (magnitude === 0) return 'unknown';
  if (WHEEL_NOTCHES.some((notch) => magnitude % notch === 0)) return 'mouse';
  return magnitude < TRACKPAD_MAX_DELTA ? 'trackpad' : 'unknown';
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
export function normalizeWheelDelta(
  event: {
    deltaX: number;
    deltaY: number;
    deltaMode: number;
    shiftKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
  },
  // Injected so the axis swap is testable off a Mac.
  darwin = isDarwin(),
): Point {
  const scale =
    event.deltaMode === 1 ? LINE_HEIGHT : event.deltaMode === 2 ? PAGE_HEIGHT : 1;
  const x = (Number.isFinite(event.deltaX) ? event.deltaX : 0) * scale;
  const y = (Number.isFinite(event.deltaY) ? event.deltaY : 0) * scale;
  // Shift + wheel is the conventional horizontal scroll on Windows and Linux,
  // where a plain mouse wheel has no horizontal axis to report. macOS and iOS
  // already perform the swap in the OS, so repeating it there would cancel out
  // (the shifted event arrives with the motion in deltaX, and we would move it
  // back into deltaY).
  if (event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && !darwin && x === 0) return { x: y, y: 0 };
  return { x, y };
}

export interface CameraWheelInput {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

/** Apply in event order, including each event's anchor and boundary clamp. */
export function cameraFromWheel(
  camera: Camera,
  event: CameraWheelInput,
  anchor: Point,
  constraints: CameraConstraints | null = null,
  viewport?: CameraViewport,
  darwin = isDarwin(),
  // Reverses scrolling, but only for an event a wheel can be held responsible
  // for — see {@link wheelPointerProfile}. Scrolling only: which way a wheel
  // zooms is a separate convention, and every application that offers this
  // leaves it alone.
  invertMouseScroll = false,
): Camera {
  const delta = normalizeWheelDelta(event, darwin);
  const zooming = event.ctrlKey || event.metaKey || event.altKey;
  const direction =
    invertMouseScroll && !zooming && wheelPointerProfile(event) === 'mouse'
      ? -1
      : 1;
  const requested = zooming
    ? zoomCameraAtScreen(camera, anchor, camera.z * (1 - clamp(delta.y, -MAX_ZOOM_DELTA, MAX_ZOOM_DELTA) / 100 * WHEEL_ZOOM_SPEED))
    : {
        ...camera,
        x: camera.x + (direction * delta.x) / camera.z,
        y: camera.y + (direction * delta.y) / camera.z,
      };
  return constrainCamera(requested, camera, constraints, viewport);
}

/** Non-passive wheel handling. Compose a pending camera with exact event order,
 * then publish once per frame. A new interaction flushes the pending movement
 * before its coordinates are read; a page switch discards it. */
export function useWheel(
  ref: RefObject<HTMLElement | null>,
  disabled = false,
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame: number | null = null;
    let pending: Camera | null = null;
    const discard = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      pending = null;
    };
    const flush = () => {
      const camera = pending;
      discard();
      if (camera) useCameraStore.getState().setCamera(camera);
    };
    const interrupt = () => {
      flush();
      useCameraStore.getState().stopCameraAnimation();
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (disabled) return;
      noteActivity();
      stopFollowingForManualCameraChange();
      const store = useCameraStore.getState();
      store.stopCameraAnimation();
      const rect = getContainerRect(el);
      pending = cameraFromWheel(
        pending ?? store.camera, e,
        { x: e.clientX - rect.left, y: e.clientY - rect.top },
        store.constraints, store.viewport, isDarwin(),
        useCanvasUiStore.getState().invertScroll,
      );
      if (frame === null) frame = requestAnimationFrame(flush);
    };
    // Programmatic navigation/following/page switches supersede queued input.
    const unsubscribe = useCameraStore.subscribe((next, prev) => {
      if (next.camera !== prev.camera || next.activeKey !== prev.activeKey || next.constraints !== prev.constraints || next.viewport !== prev.viewport) discard();
    });
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', interrupt, true);
    el.addEventListener('gesturestart', interrupt, true);
    window.addEventListener('blur', discard);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', interrupt, true);
      el.removeEventListener('gesturestart', interrupt, true);
      window.removeEventListener('blur', discard);
      unsubscribe();
      discard();
    };
  }, [ref, disabled]);
}
