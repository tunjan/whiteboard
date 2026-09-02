import { useRef, type RefObject } from 'react';
import { useHoverCursor } from '@/hooks/use-hover-cursor';

interface LaserCursorProps {
  containerRef: RefObject<HTMLDivElement | null>;
}

/**
 * A glowing laser pointer spot that follows mouse and pen hover over the canvas.
 *
 * Modeled on the optical signature of a real handheld laser diode: an intense
 * white-hot focal core, a vibrant ruby transition, an ethereal radial bloom,
 * and faint diffraction rays from the emitter aperture.
 */
export function LaserCursor({ containerRef }: LaserCursorProps) {
  const cursorRef = useRef<HTMLDivElement>(null);

  useHoverCursor(containerRef, cursorRef);

  return (
    <div
      ref={cursorRef}
      aria-hidden="true"
      className="pointer-events-none absolute top-0 left-0 z-[var(--z-canvas-front)] size-8 opacity-0 will-change-transform flex items-center justify-center"
    >
      <svg
        viewBox="0 0 32 32"
        width={32}
        height={32}
        className="overflow-visible"
      >
        <defs>
          <radialGradient id="laser-cursor-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FF3B30" stopOpacity={0.65} />
            <stop offset="45%" stopColor="#FF3B30" stopOpacity={0.25} />
            <stop offset="100%" stopColor="#FF3B30" stopOpacity={0} />
          </radialGradient>
        </defs>

        {/* Soft flat laser glow */}
        <circle cx={16} cy={16} r={11} fill="url(#laser-cursor-glow)" />

        {/* Flat laser dot */}
        <circle cx={16} cy={16} r={3.5} fill="#FF3B30" />
        <circle cx={16} cy={16} r={1.5} fill="#FFFFFF" />
      </svg>
    </div>
  );
}
