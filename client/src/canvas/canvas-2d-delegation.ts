// Which shapes the Canvas2D renderer hands back to the DOM.
//
// A canvas is one element in one stacking slot, so a shape the DOM owns sits
// either wholly above or wholly below everything the canvas paints. That is
// fine until a painted shape belongs *between* two DOM ones — ink annotating a
// bookmark card, a rectangle boxing an equation.
//
// Paint order only decides anything where two shapes overlap, so the rule is
// exactly that: a shape above a DOM-owned shape whose bounds it overlaps is
// delegated to the DOM as well, and the canvas skips it. Transitively, because
// a delegated shape is now itself DOM-owned and whatever sits above *it* has
// the same problem.
//
// On the boards this renderer exists for the set is empty: DOM-owned content is
// rare and usually the most recently created thing on the page, so nothing is
// above it. The cost lands only where the stacking actually demands it.
import type { Bounds } from '@whiteboard/shared';

export interface StackedShape {
  id: string;
  /** Integer paint order — `SceneNode.z`. */
  z: number;
  bounds: Bounds;
}

/**
 * The ids the canvas must not paint: `roots` plus everything stacked above one
 * of them that overlaps it.
 *
 * `overlapping` answers with the shapes whose bounds meet the given shape's —
 * the spatial index, on the live board. It may return the shape itself and
 * shapes below it; both are rejected here.
 */
export function delegatedShapeIds(
  roots: readonly StackedShape[],
  overlapping: (shape: StackedShape) => Iterable<StackedShape>,
): Set<string> {
  const delegated = new Set<string>(roots.map((shape) => shape.id));
  const queue = [...roots];
  while (queue.length) {
    const below = queue.pop()!;
    for (const candidate of overlapping(below)) {
      if (candidate.z <= below.z || delegated.has(candidate.id)) continue;
      delegated.add(candidate.id);
      // Newly delegated, so it now sits in the DOM and the same question is
      // open for whatever overlaps *it*.
      queue.push(candidate);
    }
  }
  return delegated;
}

/** Whether two axis-aligned boxes share any area. */
export function boundsOverlap(a: Bounds, b: Bounds): boolean {
  return (
    a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY
  );
}
