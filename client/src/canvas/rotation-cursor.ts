import { rotatedCursor } from './cursor-svg';
import type { RotationHandleId } from './selection-geometry';

/** Base angle of each corner's glyph, before the selection's own rotation. */
const ROTATION_CURSOR_ANGLE: Record<RotationHandleId, number> = {
  'rotate-nw': 0,
  'rotate-ne': 90,
  'rotate-se': 180,
  'rotate-sw': 270,
};

/**
 * A corner-oriented curved arrow. Its path spans 1..21 of the 32px box, so it
 * is shifted to centre on the hotspot the glyph turns about.
 */
const ARROW = 'M21 21C21 12.72 14.28 6 6 6M11 1 6 6l5 5';

/** The rotate cursor for a corner zone on a selection turned by `rotation`. */
export function rotationCursor(
  id: RotationHandleId,
  selectionRotation: number,
): string {
  return rotatedCursor({
    path: ARROW,
    angle: ROTATION_CURSOR_ANGLE[id] + (selectionRotation * 180) / Math.PI,
    translate: [5, 5],
    fallback: 'default',
  });
}
