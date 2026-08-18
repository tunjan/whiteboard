import type { CursorVariantProps } from './cursor-types';

/** Precision direction: a fixed reticle keeps the stroke origin unobscured. */
export function PrecisionCursor({ color, cursorRef }: CursorVariantProps) {
  const ticks = 'M14 1V7 M14 21V27 M1 14H7 M21 14H27';

  return (
    <div
      ref={cursorRef}
      aria-hidden="true"
      className="pointer-events-none absolute top-0 left-0 z-20 opacity-0 will-change-transform"
    >
      <svg
        className="size-7 -translate-x-1/2 -translate-y-1/2 overflow-visible"
        viewBox="0 0 28 28"
        fill="none"
      >
        <path
          d={ticks}
          stroke="var(--color-background)"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path
          d={ticks}
          stroke="var(--color-foreground)"
          strokeWidth="1"
          strokeLinecap="round"
        />
        <circle
          cx="14"
          cy="14"
          r="2.5"
          fill={color}
          stroke="var(--color-background)"
          strokeWidth="1"
        />
      </svg>
    </div>
  );
}
