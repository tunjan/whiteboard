import { rotatedCursor } from './cursor-svg';
import { rotateResizeHandle, type ResizeHandleId } from './selection-geometry';

/**
 * Base angle of each handle's glyph: the direction that edge or corner travels
 * in, on an unrotated box. Opposite handles share an angle because the glyph is
 * a double-headed arrow, symmetric under a half turn.
 */
const RESIZE_CURSOR_ANGLE: Record<ResizeHandleId, number> = {
  e: 0,
  w: 0,
  se: 45,
  nw: 45,
  n: 90,
  s: 90,
  ne: 135,
  sw: 135,
};

/** The keyword a browser falls back to, quantized to the nearest 45 degrees. */
const RESIZE_FALLBACK: Record<ResizeHandleId, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
};

/** A double-headed arrow centred on the hotspot, pointing along the x-axis. */
const ARROWS = 'M10 11 5 16l5 5M5 16h22M22 11l5 5-5 5';

/**
 * The cursor for a resize handle on a box turned by `rotation`. A handle keeps
 * its name through a rotation but not its direction: the north-west grip of a
 * box turned a quarter turn is dragged north-east, and the cursor has to say
 * which way the edge actually moves.
 *
 * The eight native keywords only land every 45 degrees, so on a box turned to
 * any other angle they point off the edge they claim to drag. The glyph is
 * drawn at the true angle instead, with a keyword behind it for the browsers
 * and platforms that refuse a data-URI cursor.
 */
export function resizeCursor(handle: ResizeHandleId, rotation: number): string {
  return rotatedCursor({
    path: ARROWS,
    angle: RESIZE_CURSOR_ANGLE[handle] + (rotation * 180) / Math.PI,
    fallback: RESIZE_FALLBACK[rotateResizeHandle(handle, rotation)],
  });
}
