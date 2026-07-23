import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
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

/**
 * Space-to-pan: while Space is held, a pointer drag pans the camera. Pointer
 * capture keeps the drag alive even if the cursor leaves the canvas.
 */
export function useSpacePan(disabled = false) {
  const panByScreen = useCameraStore((s) => s.panByScreen);
  const [isSpaceDown, setSpaceDown] = useState(false);
  const [isPanning, setPanning] = useState(false);
  const last = useRef<{ x: number; y: number } | null>(null);

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

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (disabled || !isSpaceDown) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      last.current = { x: e.clientX, y: e.clientY };
      setPanning(true);
    },
    [disabled, isSpaceDown],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (disabled || !isPanning || !last.current) return;
      const dx = e.clientX - last.current.x;
      const dy = e.clientY - last.current.y;
      last.current = { x: e.clientX, y: e.clientY };
      // Drag right -> camera moves left so content follows the cursor.
      panByScreen(-dx, -dy);
    },
    [disabled, isPanning, panByScreen],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent) => {
      if (!isPanning) return;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      last.current = null;
      setPanning(false);
    },
    [isPanning],
  );

  const cancel = useCallback(() => {
    last.current = null;
    setPanning(false);
  }, []);

  return {
    isSpaceDown,
    isPanning,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    cancel,
  };
}
