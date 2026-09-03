import { useRef, type RefObject } from 'react';
import { useHoverCursor } from '@/hooks/use-hover-cursor';
import { useStyleStore } from './use-style-store';

/**
 * Pencil barrel in the viewBox below: a square point at the lower left, sides
 * running up at 45 degrees, a rounded eraser at the upper right.
 */
const PENCIL_BODY =
  'M 4 20 L 4 15.19 L 15.6 3.6 Q 17.15 2.04 18.71 3.6 L 20.4 5.29 Q 21.96 6.85 20.4 8.4 L 8.81 20 Z';
/**
 * Where the sharpened point meets the barrel. It sits further up than the
 * silhouette's corner needs, which lengthens the point into a wedge big enough
 * to read as a block of colour at cursor size.
 */
const PENCIL_LEAD = 'M 6.69 12.5 L 11.5 17.31';
/** The metal band holding the eraser. */
const PENCIL_FERRULE = 'M 13.26 5.93 L 18.07 10.74';
/** The sharpened point, filled with the current colour. */
const PENCIL_INK =
  'M 4 20 L 4 15.19 L 6.69 12.5 L 11.5 17.31 L 8.81 20 Z';

const VIEWBOX = 24;
const PENCIL_PX = 28;
const STROKE = 1.1;
/** Where the pencil meets the page, in viewBox units — this is the hotspot. */
const PENCIL_POINT = { x: 4, y: 20 };

interface DrawingCursorProps {
  containerRef: RefObject<HTMLDivElement | null>;
}

/** A pencil that follows mouse and pen hover without re-rendering. */
export function DrawingCursor({ containerRef }: DrawingCursorProps) {
  const cursorRef = useRef<HTMLDivElement>(null);
  // The pencil cursor is only ever shown for the pen, so it shows the pen's
  // remembered colour.
  const color = useStyleStore((state) => state.groups.pen.color);

  useHoverCursor(containerRef, cursorRef);

  return (
    // The wrapper has no size, so the hover hook's centring translate lands its
    // origin exactly on the pointer; the pencil then hangs off that origin by
    // its point, which is where the stroke actually comes out.
    <div
      ref={cursorRef}
      aria-hidden="true"
      className="pointer-events-none absolute top-0 left-0 z-[var(--z-canvas-front)] size-0 opacity-0 will-change-transform"
    >
      <svg
        viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
        width={PENCIL_PX}
        height={PENCIL_PX}
        className="absolute"
        style={{
          left: -(PENCIL_POINT.x / VIEWBOX) * PENCIL_PX,
          top: -(PENCIL_POINT.y / VIEWBOX) * PENCIL_PX,
        }}
      >
        {/* White body over a black outline, fixed rather than themed: the
            pencil sits on top of the drawing, so it has to stay legible over
            whatever ink is underneath it rather than over the canvas colour.
            Stroking the fill in white widens it into a rim past the outline. */}
        <path
          d={PENCIL_BODY}
          strokeWidth={STROKE + 1.7}
          strokeLinejoin="round"
          strokeLinecap="round"
          className="fill-white stroke-white"
        />
        <path d={PENCIL_INK} fill={color} />
        <g
          fill="none"
          strokeWidth={STROKE}
          strokeLinejoin="round"
          strokeLinecap="round"
          className="stroke-black"
        >
          <path d={PENCIL_BODY} />
          <path d={PENCIL_LEAD} />
          <path d={PENCIL_FERRULE} />
        </g>
      </svg>
    </div>
  );
}
