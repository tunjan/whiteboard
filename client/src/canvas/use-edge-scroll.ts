import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { Point } from './camera';
import { edgeProximityVector, edgeScrollDelta } from './edge-scroll';
import { useCameraStore } from './use-camera-store';

interface EdgeScrollOptions {
  /** Live viewport size in CSS pixels. */
  getViewportSize: () => { width: number; height: number };
  /**
   * Re-deliver the pointer to the active tool after the camera has moved. The
   * pointer has not moved on screen, but the world point beneath it has, and a
   * shape being dragged has to follow that — without this the camera scrolls
   * away and leaves the drag behind.
   */
  onScroll: () => void;
}

/**
 * Pans the camera while a drag is held against the edge of the viewport.
 *
 * Runs its own frame loop rather than panning from pointer moves: the pointer
 * stops producing events the moment it stops moving, which is exactly the
 * position — parked in the margin — where scrolling has to keep going.
 */
export function useEdgeScroll({
  getViewportSize,
  onScroll,
}: EdgeScrollOptions) {
  const point = useRef<Point | null>(null);
  const since = useRef(0);
  const previousFrame = useRef(0);
  const frame = useRef<number | null>(null);
  const onScrollRef = useRef(onScroll);
  onScrollRef.current = onScroll;
  const sizeRef = useRef(getViewportSize);
  sizeRef.current = getViewportSize;

  const stop = useCallback(() => {
    point.current = null;
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
  }, []);

  const tick = useCallback((now: number) => {
    const at = point.current;
    if (!at) {
      frame.current = null;
      return;
    }
    const { width, height } = sizeRef.current();
    const proximity = edgeProximityVector(at, width, height);
    if (proximity.x === 0 && proximity.y === 0) {
      // Pulled back out of the margin: the ramp restarts from scratch next time
      // rather than resuming at the speed it had reached.
      frame.current = null;
      point.current = null;
      return;
    }
    const frameMs = Math.min(50, Math.max(0, now - previousFrame.current));
    previousFrame.current = now;
    const delta = edgeScrollDelta(
      proximity,
      width,
      height,
      now - since.current,
      frameMs,
    );
    if (delta.x !== 0 || delta.y !== 0) {
      useCameraStore.getState().panByScreen(delta.x, delta.y);
      onScrollRef.current();
    }
    frame.current = requestAnimationFrame(tick);
  }, []);

  /**
   * Report where a live drag is. Call on every pointer move of the drag; call
   * {@link stop} when it ends.
   */
  const track = useCallback(
    (at: Point) => {
      const { width, height } = sizeRef.current();
      const proximity = edgeProximityVector(at, width, height);
      if (proximity.x === 0 && proximity.y === 0) {
        stop();
        return;
      }
      point.current = at;
      if (frame.current === null) {
        const now = performance.now();
        since.current = now;
        previousFrame.current = now;
        frame.current = requestAnimationFrame(tick);
      }
    },
    [stop, tick],
  );

  useEffect(() => stop, [stop]);

  // Stable identity: this is a dependency of the canvas's pointer-move handler,
  // which should not be rebuilt every render.
  return useMemo(() => ({ track, stop }), [track, stop]);
}
