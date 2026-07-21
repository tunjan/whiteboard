// Default drawing style for newly-created shapes.
export const DEFAULT_SHAPE_STYLE = {
  /** Stroke color. Matches the first available drawing swatch. */
  color: '#274001',
  /** Stroke width in world units. */
  size: 2,
} as const;

/** Default freehand ink width (perfect-freehand `size`). */
export const DEFAULT_INK_SIZE = 6;

/** Corner radius for media shapes (image, video), matching --radius-xl. */
export const MEDIA_CORNER_RADIUS = 12;
