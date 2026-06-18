import type { Shape } from '@whiteboard/shared';

/** Dimming coefficient the eraser applies once to a targeted shape sub-tree. */
export const ERASE_DIM = 0.32;

/** A shape's own opacity, clamped to the [0, 1] unit interval (undefined = 1). */
function localOpacity(s: Shape): number {
  const o = s.opacity ?? 1;
  return o < 0 ? 0 : o > 1 ? 1 : o;
}

/**
 * Final render opacity for a shape.
 *
 * Hierarchical compounding: the product of the shape's own local opacity and
 * those of all its ancestor containers (groups/frames). Groups create no DOM
 * node, so this product is computed explicitly rather than left to the SVG
 * compositor — each shape carries its full ancestor-inclusive opacity.
 *
 * Eraser gate: when the shape *or any ancestor* is queued for deletion, the
 * result is dimmed by {@link ERASE_DIM} exactly once. Applying it a single time
 * per sub-tree (rather than once per marked node) keeps nested marked shapes
 * from multiplying the factor down to near-invisibility.
 */
export function resolveOpacity(
  shape: Shape,
  getShape: (id: string) => Shape | undefined,
  isMarked: (id: string) => boolean,
): number {
  let alpha = localOpacity(shape);
  let marked = isMarked(shape.id);
  const seen = new Set<string>([shape.id]);
  let cur = shape.parentId ? getShape(shape.parentId) : undefined;
  while (cur && !seen.has(cur.id)) {
    alpha *= localOpacity(cur);
    if (isMarked(cur.id)) marked = true;
    seen.add(cur.id);
    cur = cur.parentId ? getShape(cur.parentId) : undefined;
  }
  return marked ? alpha * ERASE_DIM : alpha;
}
