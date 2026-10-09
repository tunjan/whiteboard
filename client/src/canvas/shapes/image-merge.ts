import type { Bounds, ShapeMap } from '@whiteboard/shared';
import { spatialIndex } from '../use-document-store';
import { shapeStore } from '../engine/shape-store';
import { useStoreValue } from '../use-shapes';
import { boxBounds } from './box-geometry';

/**
 * Squaring off the corners where two images meet.
 *
 * An image carries a rounded corner, which reads as a defect once two of them
 * are placed flush: the two curves leave a lens-shaped notch in what should be
 * a continuous edge. A corner is dropped when a neighbouring image covers it,
 * so a run or a grid of touching images reads as one block while the outer
 * corners of the block stay rounded.
 */

export const CORNER_TL = 1;
export const CORNER_TR = 2;
export const CORNER_BR = 4;
export const CORNER_BL = 8;

/** How far apart two edges may sit, in world units, and still count as flush. */
const CONTACT_TOLERANCE = 1;

/**
 * How far a neighbour must reach past a corner, in world units, before that
 * corner counts as covered. Without it two images that merely touch at a point
 * — diagonal neighbours in a grid — would each square a corner the other never
 * fills in.
 */
const MIN_CONTACT = 2;

function near(a: number, b: number): boolean {
  return Math.abs(a - b) <= CONTACT_TOLERANCE;
}

/**
 * Which of the two corners bounding `[lo, hi]` a neighbour spanning
 * `[nLo, nHi]` covers. `loCorner` sits at `lo`, `hiCorner` at `hi`.
 */
function covered(
  nLo: number,
  nHi: number,
  lo: number,
  hi: number,
  loCorner: number,
  hiCorner: number,
): number {
  let mask = 0;
  if (nLo <= lo + CONTACT_TOLERANCE && nHi >= lo + MIN_CONTACT)
    mask |= loCorner;
  if (nHi >= hi - CONTACT_TOLERANCE && nLo <= hi - MIN_CONTACT)
    mask |= hiCorner;
  return mask;
}

/** Corners of `rect` that a flush `neighbors` box covers, as a corner mask. */
export function squaredCorners(
  rect: Bounds,
  neighbors: readonly Bounds[],
): number {
  let mask = 0;
  for (const n of neighbors) {
    if (near(n.minX, rect.maxX)) {
      mask |= covered(
        n.minY,
        n.maxY,
        rect.minY,
        rect.maxY,
        CORNER_TR,
        CORNER_BR,
      );
    } else if (near(n.maxX, rect.minX)) {
      mask |= covered(
        n.minY,
        n.maxY,
        rect.minY,
        rect.maxY,
        CORNER_TL,
        CORNER_BL,
      );
    } else if (near(n.minY, rect.maxY)) {
      mask |= covered(
        n.minX,
        n.maxX,
        rect.minX,
        rect.maxX,
        CORNER_BL,
        CORNER_BR,
      );
    } else if (near(n.maxY, rect.minY)) {
      mask |= covered(
        n.minX,
        n.maxX,
        rect.minX,
        rect.maxX,
        CORNER_TL,
        CORNER_TR,
      );
    }
  }
  return mask;
}

/**
 * The corner mask for `shape` against the images it currently touches.
 *
 * The selector yields a small integer, so an image re-renders only when a
 * neighbour actually arrives at or leaves one of its edges — not on every frame
 * of the drag that brings it there. Rotated boxes are left alone: their edges
 * no longer align to the axes the contact test is expressed in.
 */
export function useMergedCorners(shape: ShapeMap['image']): number {
  return useStoreValue(() => {
    // The spatial index is not a signal, so a neighbour arriving from outside
    // the current contact set is only seen by re-running on every publish.
    shapeStore.sorted.get();
    if (shape.rotation) return 0;
    const rect = boxBounds(shape.x, shape.y, shape.props.w, shape.props.h);
    const neighbors: Bounds[] = [];
    for (const id of spatialIndex.search({
      minX: rect.minX - CONTACT_TOLERANCE,
      minY: rect.minY - CONTACT_TOLERANCE,
      maxX: rect.maxX + CONTACT_TOLERANCE,
      maxY: rect.maxY + CONTACT_TOLERANCE,
    })) {
      if (id === shape.id) continue;
      const other = shapeStore.peek(id);
      if (!other || other.type !== 'image' || other.rotation) continue;
      neighbors.push(boxBounds(other.x, other.y, other.props.w, other.props.h));
    }
    return squaredCorners(rect, neighbors);
  }, [shape]);
}

function corner(r: number, x: number, y: number): string {
  return r > 0 ? `A${r} ${r} 0 0 1 ${x} ${y}` : `L${x} ${y}`;
}

/**
 * A `radius`-rounded rectangle with every corner in `squared` mitred flat.
 * An SVG `rect` carries one `rx` for all four corners, so the box has to be
 * spelled out as a path once any of them differ.
 */
export function mergedRectPath(
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  squared: number,
): string {
  const tl = squared & CORNER_TL ? 0 : radius;
  const tr = squared & CORNER_TR ? 0 : radius;
  const br = squared & CORNER_BR ? 0 : radius;
  const bl = squared & CORNER_BL ? 0 : radius;
  return [
    `M${x + tl} ${y}`,
    `H${x + w - tr}`,
    corner(tr, x + w, y + tr),
    `V${y + h - br}`,
    corner(br, x + w - br, y + h),
    `H${x + bl}`,
    corner(bl, x, y + h - bl),
    `V${y + tl}`,
    corner(tl, x + tl, y),
    'Z',
  ].join('');
}
