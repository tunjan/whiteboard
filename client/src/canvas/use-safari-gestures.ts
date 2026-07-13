import { useEffect, type RefObject } from 'react';
import { stopFollowingForManualCameraChange } from '@/collab/use-follow-store';
import { useCameraStore } from './use-camera-store';

// Safari's non-standard pinch events (not in the DOM lib types). `scale` is
// cumulative relative to gesturestart; clientX/clientY give the gesture center.
interface SafariGestureEvent extends Event {
  readonly scale: number;
  readonly clientX: number;
  readonly clientY: number;
}

/**
 * Safari delivers trackpad pinch as `gesturestart`/`gesturechange`/`gestureend`
 * rather than `wheel`+ctrlKey. Handle them (non-passive, preventDefault) so
 * pinch zooms the canvas instead of the page. No-op in browsers that don't
 * fire these events.
 */
export function useSafariGestures(
  ref: RefObject<HTMLElement | null>,
  disabled = false,
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let startZoom = 1;
    let lastAnchor = { x: 0, y: 0 };

    const anchorFrom = (e: SafariGestureEvent) => {
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      return Number.isFinite(x) && Number.isFinite(y)
        ? { x, y }
        : { x: rect.width / 2, y: rect.height / 2 };
    };

    const onStart = (ev: Event) => {
      const e = ev as SafariGestureEvent;
      e.preventDefault();
      if (disabled) return;
      stopFollowingForManualCameraChange();
      startZoom = useCameraStore.getState().camera.z;
      lastAnchor = anchorFrom(e);
    };
    const onChange = (ev: Event) => {
      const e = ev as SafariGestureEvent;
      e.preventDefault();
      if (disabled) return;
      const anchor = anchorFrom(e);
      useCameraStore.getState().zoomAtScreenWithPan(
        anchor,
        startZoom * e.scale,
        anchor.x - lastAnchor.x,
        anchor.y - lastAnchor.y,
      );
      lastAnchor = anchor;
    };
    const onEnd = (ev: Event) => ev.preventDefault();

    el.addEventListener('gesturestart', onStart, { passive: false });
    el.addEventListener('gesturechange', onChange, { passive: false });
    el.addEventListener('gestureend', onEnd, { passive: false });
    return () => {
      el.removeEventListener('gesturestart', onStart);
      el.removeEventListener('gesturechange', onChange);
      el.removeEventListener('gestureend', onEnd);
    };
  }, [ref, disabled]);
}
