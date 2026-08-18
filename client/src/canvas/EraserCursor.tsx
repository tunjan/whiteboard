import { useRef, type RefObject } from 'react';
import { useHoverCursor } from '@/hooks/use-hover-cursor';
import { ERASER_SCREEN_RADIUS } from './tools/eraser-tool';

interface EraserCursorProps {
  containerRef: RefObject<HTMLDivElement | null>;
}

/**
 * The eraser's reach, drawn where the pointer is.
 *
 * A crosshair says where the eraser is but not how much it takes, which is the
 * one thing that matters when cutting through ink rather than removing whole
 * shapes. The ring is the collision radius itself, and since that radius is
 * defined in screen pixels it is the same circle at every zoom. Hollow, so the
 * ink about to be cut stays visible underneath.
 */
export function EraserCursor({ containerRef }: EraserCursorProps) {
  const cursorRef = useRef<HTMLDivElement>(null);

  useHoverCursor(containerRef, cursorRef);

  return (
    <div
      ref={cursorRef}
      aria-hidden="true"
      className="pointer-events-none absolute top-0 left-0 z-[var(--z-canvas-front)] rounded-full border border-foreground/60 opacity-0 ring-1 ring-background/80 will-change-transform"
      style={{ width: ERASER_SCREEN_RADIUS * 2, height: ERASER_SCREEN_RADIUS * 2 }}
    />
  );
}
