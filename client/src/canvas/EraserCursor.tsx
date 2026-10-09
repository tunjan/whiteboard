import { useRef, type RefObject } from 'react';
import { useHoverCursor } from '@/hooks/use-hover-cursor';

/**
 * Eraser block drawn lying flat, its rubbing face on the left edge and centred
 * on the origin; `ERASER_TILT` stands it up like the pencil, running at 45
 * degrees to the upper right. Well-rounded corners keep it reading as a soft
 * rubber rather than a box.
 */
const ERASER_LENGTH = 17;
const ERASER_HALF_WIDTH = 4.25;
const ERASER_RADIUS = 2.6;
/** How far along the body the rubber gives way to the sleeve. */
const ERASER_SEAM_AT = 6;
/** The rubber up to the seam: rounded where it meets the page, square at the seam. */
const ERASER_RUBBER = `M ${ERASER_SEAM_AT} ${-ERASER_HALF_WIDTH} H ${ERASER_RADIUS} A ${ERASER_RADIUS} ${ERASER_RADIUS} 0 0 0 0 ${-ERASER_HALF_WIDTH + ERASER_RADIUS} V ${ERASER_HALF_WIDTH - ERASER_RADIUS} A ${ERASER_RADIUS} ${ERASER_RADIUS} 0 0 0 ${ERASER_RADIUS} ${ERASER_HALF_WIDTH} H ${ERASER_SEAM_AT} Z`;

const VIEWBOX = 24;
const ERASER_PX = 28;
const STROKE = 1.1;
/** Middle of the rubbing face, in viewBox units — this is the hotspot. */
const ERASER_FACE = { x: 6, y: 18 };
const BODY_RECT = {
  x: 0,
  y: -ERASER_HALF_WIDTH,
  width: ERASER_LENGTH,
  height: ERASER_HALF_WIDTH * 2,
  rx: ERASER_RADIUS,
};
const ERASER_TILT = `translate(${ERASER_FACE.x} ${ERASER_FACE.y}) rotate(-45)`;

/**
 * The eraser, hung off its parent's origin by the middle of its rubbing face.
 * Peers' cursors reuse it with the rubber in their own colour.
 */
export function EraserGlyph({ rubber = '#f4a7b9' }: { rubber?: string }) {
  return (
    <svg
      viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
      width={ERASER_PX}
      height={ERASER_PX}
      className="absolute"
      style={{
        left: -(ERASER_FACE.x / VIEWBOX) * ERASER_PX,
        top: -(ERASER_FACE.y / VIEWBOX) * ERASER_PX,
      }}
    >
      {/* Fixed white-on-black like the pencil, so it stays legible over any
          ink it is about to rub out. */}
      <g transform={ERASER_TILT} strokeLinejoin="round" strokeLinecap="round">
        <rect
          {...BODY_RECT}
          strokeWidth={STROKE + 1.7}
          className="fill-white stroke-white"
        />
        <path d={ERASER_RUBBER} fill={rubber} />
        <g fill="none" strokeWidth={STROKE} className="stroke-black">
          <rect {...BODY_RECT} />
          <path
            d={`M ${ERASER_SEAM_AT} ${-ERASER_HALF_WIDTH} V ${ERASER_HALF_WIDTH}`}
          />
        </g>
      </g>
    </svg>
  );
}

interface EraserCursorProps {
  containerRef: RefObject<HTMLDivElement | null>;
}

/** An eraser that follows mouse and pen hover without re-rendering. */
export function EraserCursor({ containerRef }: EraserCursorProps) {
  const cursorRef = useRef<HTMLDivElement>(null);

  useHoverCursor(containerRef, cursorRef);

  return (
    // Same zero-size wrapper as the pencil: the origin sits on the pointer and
    // the eraser hangs off it by the middle of its rubbing face.
    <div
      ref={cursorRef}
      aria-hidden="true"
      className="pointer-events-none absolute top-0 left-0 z-[var(--z-canvas-front)] size-0 opacity-0 will-change-transform"
    >
      <EraserGlyph />
    </div>
  );
}
