import type { CursorVariantProps } from './cursor-types';

/** WYSIWYG direction: a quiet frame containing the brush's exact footprint. */
export function FootprintCursor({
  brushSize,
  color,
  cursorRef,
}: CursorVariantProps) {
  const frameSize = Math.max(20, brushSize + 8);

  return (
    <div
      ref={cursorRef}
      aria-hidden="true"
      className="pointer-events-none absolute top-0 left-0 z-20 opacity-0 will-change-transform"
    >
      <span
        className="absolute block -translate-x-1/2 -translate-y-1/2 rounded-full border border-background bg-background/80 ring-1 ring-foreground/30"
        style={{ width: frameSize, height: frameSize }}
      />
      <span
        className="absolute block -translate-x-1/2 -translate-y-1/2 rounded-full border"
        style={{ width: brushSize, height: brushSize, borderColor: color }}
      >
        <span
          className="absolute inset-0 rounded-full opacity-20"
          style={{ backgroundColor: color }}
        />
      </span>
      <span
        className="absolute block size-1 -translate-x-1/2 -translate-y-1/2 rounded-full border border-background"
        style={{ backgroundColor: color }}
      />
    </div>
  );
}
