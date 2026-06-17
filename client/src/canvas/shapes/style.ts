// Default drawing style for newly-created shapes. The full color/stroke-width
// palette and its UI arrive in Phase 13; this is the single default source.
export const DEFAULT_SHAPE_STYLE = {
  /** Stroke color. A theme token so it reads in light and dark for now. */
  color: 'var(--color-foreground)',
  /** Stroke width in world units. */
  size: 2,
} as const;

/** Default freehand ink width (perfect-freehand `size`). */
export const DEFAULT_INK_SIZE = 6;
