// Pure minimap math: the projection between world space and the minimap's own
// screen box, and the constraints its drag applies to a target viewport centre.
//
// Kept separate from the renderer and the gesture handler because it is the
// part with edge cases worth pinning down — a page with no shapes, a page
// narrower than the minimap, a drag past the far edge of the drawing — and none
// of them need a canvas or a pointer to test.

import type { Bounds, Point } from './geometry';
import { boundsCenter, unionBounds } from './geometry';

export interface Size {
  width: number;
  height: number;
}

/** World-space size of a bounds, as a {@link Size}. */
export function boundsSize(b: Bounds): Size {
  return { width: b.maxX - b.minX, height: b.maxY - b.minY };
}

/**
 * Everything the minimap has to enclose: the drawing, plus wherever the user is
 * currently looking.
 *
 * Including the viewport is what stops the frame collapsing under the camera.
 * Without it, clearing a page would shrink the content box to nothing and the
 * viewport rectangle would jump to a wildly different scale in one frame.
 */
export function contentPageBounds(
  shapes: Bounds | null,
  viewport: Bounds,
): Bounds {
  return shapes ? unionBounds(shapes, viewport) : viewport;
}

/**
 * The world rectangle the minimap actually projects: `content` grown along one
 * axis until it matches the minimap element's aspect ratio, then re-centred on
 * the content.
 *
 * Growing (never cropping) is what keeps the projection uniform in both axes —
 * a minimap that squashed the long axis to fit would render every shape at the
 * wrong proportions and make the viewport rectangle lie about its shape.
 */
export function fitPageBounds(content: Bounds, screen: Size): Bounds {
  const { width: contentW, height: contentH } = boundsSize(content);
  const aspect = screen.height > 0 ? screen.width / screen.height : 1;
  if (!(aspect > 0) || !Number.isFinite(aspect)) return content;

  let width = contentW;
  let height = width / aspect;
  if (!(height >= contentH)) {
    height = contentH;
    width = height * aspect;
  }
  if (!(width > 0 && height > 0)) return content;

  const center = boundsCenter(content);
  return {
    minX: center.x - width / 2,
    minY: center.y - height / 2,
    maxX: center.x + width / 2,
    maxY: center.y + height / 2,
  };
}

/**
 * Minimap screen pixels per world unit. One number for both axes — {@link
 * fitPageBounds} has already made the two ratios equal.
 *
 * Zero when either box is degenerate, which callers treat as "nothing to draw
 * and nothing to point at" rather than dividing by it.
 */
export function minimapZoom(page: Bounds, screen: Size): number {
  const { width } = boundsSize(page);
  if (!(width > 0) || !(screen.width > 0)) return 0;
  const zoom = screen.width / width;
  return Number.isFinite(zoom) ? zoom : 0;
}

/**
 * Project a point in the minimap element's own coordinates (CSS pixels from its
 * top-left) back into world space.
 */
export function minimapPointToPage(
  offset: Point,
  page: Bounds,
  screen: Size,
): Point {
  const size = boundsSize(page);
  const sx = screen.width > 0 ? size.width / screen.width : 0;
  const sy = screen.height > 0 ? size.height / screen.height : 0;
  return {
    x: page.minX + offset.x * sx,
    y: page.minY + offset.y * sy,
  };
}

/**
 * Where a press on the minimap counts as "take me there" rather than "grab the
 * viewport": the content box, grown by half a viewport on every side.
 *
 * The margin is what lets you aim just past the last shape and still get a jump
 * — pressing exactly on the content edge should put that edge at the edge of
 * the screen, not refuse.
 */
export function allowedJumpBounds(content: Bounds, viewport: Size): Bounds {
  return {
    minX: content.minX - viewport.width / 2,
    minY: content.minY - viewport.height / 2,
    maxX: content.maxX + viewport.width / 2,
    maxY: content.maxY + viewport.height / 2,
  };
}

/**
 * Constrain a target viewport centre so a drag cannot wander into empty space,
 * with a damped overshoot near the edges.
 *
 * The `(lx - rx) / 2` term is the interesting half. Once the viewport is wider
 * than the whole drawing, the permitted range inverts — the left limit passes
 * the right one — and a plain clamp would pin the drawing to whichever edge was
 * hit first. Averaging the two overflows instead pulls the target back toward
 * the drawing's centre, so a small sketch settles in the middle of the screen.
 *
 * `viewport` is the viewport's size in *world* units (screen size / zoom).
 */
export function dampToShapeBounds(
  target: Point,
  shapes: Bounds,
  viewport: Size,
): Point {
  const minX = shapes.minX - viewport.width / 2;
  const maxX = shapes.maxX + viewport.width / 2;
  const minY = shapes.minY - viewport.height / 2;
  const maxY = shapes.maxY + viewport.height / 2;

  let { x, y } = target;
  const lx = Math.max(0, minX + viewport.width - x);
  const rx = Math.max(0, x - (maxX - viewport.width));
  const ly = Math.max(0, minY + viewport.height - y);
  const ry = Math.max(0, y - (maxY - viewport.height));

  x += (lx - rx) / 2;
  y += (ly - ry) / 2;

  return {
    x: Math.min(maxX, Math.max(minX, x)),
    y: Math.min(maxY, Math.max(minY, y)),
  };
}

/** Hold a drag to whichever axis it has travelled furthest along. */
export function snapToDominantAxis(target: Point, origin: Point): Point {
  const dx = Math.abs(target.x - origin.x);
  const dy = Math.abs(target.y - origin.y);
  return dx > dy ? { x: target.x, y: origin.y } : { x: origin.x, y: target.y };
}

/** Screen-pixel corner radius the viewport rectangle is drawn with. */
export const VIEWPORT_RADIUS_SCREEN = 4;

/**
 * Corner radius for the viewport rectangle in world units, or `null` when it
 * would land inside a single pixel.
 *
 * Four Bézier corners cost more to rasterize than a rectangle, and zoomed far
 * enough out the curve is smaller than the pixel it is drawn on, so there is
 * nothing to see for the cost.
 */
export function viewportRadius(
  viewport: Size,
  zoom: number,
): number | null {
  if (!(zoom > 0)) return null;
  const r = Math.min(
    viewport.width / 4,
    viewport.height / 4,
    VIEWPORT_RADIUS_SCREEN / zoom,
  );
  return r * zoom < 1 ? null : r;
}
