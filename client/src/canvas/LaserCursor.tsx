import { useRef, type RefObject } from 'react';
import { useHoverCursor } from '@/hooks/use-hover-cursor';
import { LaserMark } from './LaserMark';

interface LaserCursorProps {
  containerRef: RefObject<HTMLDivElement | null>;
}

/** The hover spot uses the same white core and soft red halo as the trail. */
export function LaserCursor({ containerRef }: LaserCursorProps) {
  const cursorRef = useRef<HTMLDivElement>(null);

  useHoverCursor(containerRef, cursorRef);

  return (
    <div
      ref={cursorRef}
      aria-hidden="true"
      className="pointer-events-none absolute top-0 left-0 z-[var(--z-canvas-front)] flex size-8 items-center justify-center opacity-0 will-change-transform"
    >
      <svg
        viewBox="0 0 32 32"
        width={32}
        height={32}
        className="overflow-visible"
      >
        <LaserMark d="M 16 16 L 16 16" />
      </svg>
    </div>
  );
}
