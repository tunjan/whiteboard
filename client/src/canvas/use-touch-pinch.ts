import { useEffect, type RefObject } from 'react';
import { stopFollowingForManualCameraChange } from '@/collab/use-follow-store';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  clampZoom,
  type Point,
} from './camera';
import { useCameraStore } from './use-camera-store';

const TOUCH_ZOOM_SPEED = 1;
const TOUCH_PAN_SPEED = 1;

interface TouchGesture {
  midpoint: Point;
  distance: number;
}

interface PinchState {
  startDistance: number;
  startZoom: number;
  lastMidpoint: Point;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function readTouchGesture(
  touches: TouchList,
  el: HTMLElement,
): TouchGesture | null {
  const a = touches.item(0);
  const b = touches.item(1);
  if (!a || !b) return null;

  const rect = el.getBoundingClientRect();
  const ax = a.clientX - rect.left;
  const ay = a.clientY - rect.top;
  const bx = b.clientX - rect.left;
  const by = b.clientY - rect.top;
  const dx = bx - ax;
  const dy = by - ay;

  return {
    midpoint: { x: (ax + bx) / 2, y: (ay + by) / 2 },
    distance: Math.hypot(dx, dy),
  };
}

function zoomFromDistance(
  startZoom: number,
  startDistance: number,
  currentDistance: number,
): number {
  if (startDistance <= 0) return startZoom;

  const minRaw = Math.pow(MIN_ZOOM, 1 / TOUCH_ZOOM_SPEED);
  const maxRaw = Math.pow(MAX_ZOOM, 1 / TOUCH_ZOOM_SPEED);
  const raw =
    Math.pow(startZoom, 1 / TOUCH_ZOOM_SPEED) *
    (currentDistance / startDistance);

  return clampZoom(Math.pow(clamp(raw, minRaw, maxRaw), TOUCH_ZOOM_SPEED));
}

export function useTouchPinch(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let pinch: PinchState | null = null;

    const beginPinch = (e: TouchEvent) => {
      const gesture = readTouchGesture(e.touches, el);
      if (!gesture) return;
      e.preventDefault();
      e.stopPropagation();
      stopFollowingForManualCameraChange();
      pinch = {
        startDistance: gesture.distance,
        startZoom: useCameraStore.getState().camera.z,
        lastMidpoint: gesture.midpoint,
      };
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) beginPinch(e);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length < 2) return;
      const gesture = readTouchGesture(e.touches, el);
      if (!gesture) return;

      e.preventDefault();
      e.stopPropagation();

      useCameraStore.getState().zoomAtScreenWithPan(
        gesture.midpoint,
        zoomFromDistance(
          pinch.startZoom,
          pinch.startDistance,
          gesture.distance,
        ),
        (gesture.midpoint.x - pinch.lastMidpoint.x) * TOUCH_PAN_SPEED,
        (gesture.midpoint.y - pinch.lastMidpoint.y) * TOUCH_PAN_SPEED,
      );

      pinch.lastMidpoint = gesture.midpoint;
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length >= 2) beginPinch(e);
      else pinch = null;
    };

    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: false });
    el.addEventListener('touchcancel', onTouchEnd, { passive: false });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [ref]);
}
