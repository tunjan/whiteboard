import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { InputsManager } from './inputs-manager';
import { useCameraStore } from './use-camera-store';

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    // MathLive's <math-field> edits in shadow DOM; events retarget to the host.
    !!el.closest?.('math-field') ||
    el.isContentEditable
  );
}

/** The mouse button that pans on its own, regardless of the active tool. */
export const MIDDLE_BUTTON = 1;
/** The mouse button that pans only once the press turns into a drag. */
export const RIGHT_BUTTON = 2;

/**
 * How far a right-button press must travel before it stops being a context
 * menu and becomes a pan.
 *
 * Small on purpose: this is the slop of a click, not a deliberate drag, so
 * anything past a few pixels was hand movement the user meant. Compared
 * squared, to keep the hypotenuse out of a pointermove handler.
 */
export const RIGHT_DRAG_THRESHOLD = 4;

/** Whether a press that has moved by (dx, dy) screen px counts as a drag. */
export function exceedsRightDragThreshold(dx: number, dy: number): boolean {
  return dx * dx + dy * dy > RIGHT_DRAG_THRESHOLD * RIGHT_DRAG_THRESHOLD;
}

/**
 * Space-to-pan: while Space is held, a pointer drag pans the camera. Pointer
 * capture keeps the drag alive even if the cursor leaves the canvas. The same
 * drag machinery also serves the middle mouse button (via {@link beginPan}),
 * which pans without any key held.
 *
 * Releasing mid-motion hands the drag's filtered velocity to the camera store,
 * which coasts it to a stop.
 */
export function useSpacePan(disabled = false) {
  const [isSpaceDown, setSpaceDown] = useState(false);
  const [isPanning, setPanning] = useState(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  // Frame-rate-independent release velocity, so a flick throws the same
  // distance on a 60 and a 120 Hz display.
  const inputs = useRef(new InputsManager());

  useEffect(() => {
    if (disabled) {
      setSpaceDown(false);
      setPanning(false);
      last.current = null;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (disabled) return;
      if (e.code !== 'Space' || e.repeat || isTypingTarget(e.target)) return;
      e.preventDefault(); // stop the page from scrolling on Space
      setSpaceDown(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceDown(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [disabled]);

  /** Start a pan drag from this pointer, whatever put us in panning mode. */
  const beginPan = useCallback((e: ReactPointerEvent) => {
    useCameraStore.getState().stopCameraAnimation();
    e.currentTarget.setPointerCapture(e.pointerId);
    last.current = { x: e.clientX, y: e.clientY };
    inputs.current.reset({ x: e.clientX, y: e.clientY }, e.timeStamp);
    setPanning(true);
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (disabled || !isSpaceDown) return;
      beginPan(e);
    },
    [disabled, isSpaceDown, beginPan],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (disabled || !isPanning || !last.current) return;
      const dx = e.clientX - last.current.x;
      const dy = e.clientY - last.current.y;
      last.current = { x: e.clientX, y: e.clientY };
      inputs.current.update({ x: e.clientX, y: e.clientY }, e.timeStamp);
      // Drag right -> camera moves left so content follows the cursor.
      useCameraStore.getState().panByScreen(-dx, -dy);
    },
    [disabled, isPanning],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent) => {
      if (!isPanning) return;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      last.current = null;
      setPanning(false);
      // Feed the release position in before reading the velocity: a drag that
      // stopped and rested before letting go should not still throw. With no
      // movement the filter decays toward zero over the elapsed time.
      const velocity = inputs.current.update(
        { x: e.clientX, y: e.clientY },
        e.timeStamp,
      );
      useCameraStore.getState().slideCamera(velocity);
      inputs.current.reset();
    },
    [isPanning],
  );

  const cancel = useCallback(() => {
    last.current = null;
    inputs.current.reset();
    setPanning(false);
  }, []);

  return {
    isSpaceDown,
    isPanning,
    beginPan,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    cancel,
  };
}
