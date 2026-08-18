/** Base stroke width multiplied by the four named size presets. */
export const BASE_STROKE_WIDTH = 2;

export const STROKE_SIZES = {
  s: 1,
  m: 1.75,
  l: 2.5,
  xl: 5,
} as const;

// Default drawing style for newly-created shapes.
export const DEFAULT_SHAPE_STYLE = {
  /** Stroke color. Matches the first available drawing swatch. */
  color: '#1d1d1d',
  /** Stroke width in world units. */
  size: BASE_STROKE_WIDTH,
} as const;

/** Default freehand ink width. */
export const DEFAULT_INK_SIZE = BASE_STROKE_WIDTH;

/** Corner radius for media shapes (image, video), matching --radius-xl. */
export const MEDIA_CORNER_RADIUS = 12;
