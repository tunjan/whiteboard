import type { CursorVariantProps } from './cursor-types';

/** Expressive direction: a physical pen silhouette lands on a precise tip. */
export function NibCursor({ color, cursorRef }: CursorVariantProps) {
  const body =
    'M8 2.5C8 1.7 8.7 1 9.5 1h5c.8 0 1.5.7 1.5 1.5v15L12 29 8 17.5v-15Z';

  return (
    <div
      ref={cursorRef}
      aria-hidden="true"
      className="pointer-events-none absolute top-0 left-0 z-20 opacity-0 will-change-transform"
    >
      <svg
        className="h-[30px] w-[24px] overflow-visible"
        viewBox="0 0 24 30"
        fill="none"
        style={{
          transform: 'translate(-50%, -100%) rotate(-32deg)',
          transformOrigin: '50% 100%',
        }}
      >
        <path
          d={body}
          fill="var(--color-background)"
          stroke="var(--color-background)"
          strokeWidth="4"
          strokeLinejoin="round"
        />
        <path
          d={body}
          fill="var(--color-background)"
          stroke="var(--color-foreground)"
          strokeWidth="1.25"
          strokeLinejoin="round"
        />
        <path d="M9 7h6" stroke={color} strokeWidth="3" strokeLinecap="round" />
        <path
          d="M12 13v10.5"
          stroke="var(--color-foreground)"
          strokeWidth="1"
          strokeLinecap="round"
        />
        <circle
          cx="12"
          cy="25"
          r="2"
          fill={color}
          stroke="var(--color-background)"
          strokeWidth="1"
        />
      </svg>
    </div>
  );
}
