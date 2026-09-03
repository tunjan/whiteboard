import {
  type Bounds,
  type Point,
  type Shape,
  boundsContainsPoint,
  isContainerType,
  rotatePoint,
  unionBounds,
} from '@whiteboard/shared';
import type { Editor } from '../editor';
import { isVisible } from '../selectable';
import { shapeRotatedBounds } from '../shape-bounds';
import { shapeRegistry } from '../shapes/shape-registry';
import { spatialIndex } from '../use-document-store';
import { segmentErasesShape, segmentIntersectsBounds } from './erase-geometry';

/**
 * Containers under the start point that must survive the whole stroke. When
 * you begin inside a frame/group, dragging across it erases the drawings in it
 * rather than the container itself. Captured once on pointer down (see
 * {@link protectedAt}). Text is ordinary erasable content, including on click.
 *
 * A group is excluded by its *bounds* rather than by a hit test, because it has
 * no geometry of its own to hit. That is what makes the stroke's origin decide
 * granularity: starting inside a group erases its members one by one, starting
 * outside it takes the group whole (see {@link eraseTargetId}).
 */
export function protectedAt(
  editor: Editor,
  p: Point,
  margin: number,
): Set<string> {
  const out = new Set<string>();
  const shapes = editor.getShapes();
  let groupBounds: Map<string, Bounds> | null = null;
  for (const shape of shapes) {
    if (!isContainerType(shape.type)) continue;
    if (!isVisible(shape)) continue;
    if (shape.type === 'group') {
      // Derived once for every group on the page: asking each group for its own
      // bounds re-walks the whole hierarchy per group, which on a board of
      // grouped diagrams is a quadratic pass on every single eraser press.
      groupBounds ??= allGroupBounds(shapes);
      const bounds = groupBounds.get(shape.id);
      if (bounds && boundsContainsPoint(expand(bounds, margin), p))
        out.add(shape.id);
      continue;
    }
    const util = shapeRegistry.getFor(shape);
    if (util?.hitTest(shape, p, margin)) out.add(shape.id);
  }
  return out;
}

/**
 * Bounds of every group on the page, in one pass: each shape that carries real
 * geometry unions itself into the groups above it. Groups nested in groups come
 * out right because the walk visits the whole ancestor chain, not just the
 * nearest parent.
 */
function allGroupBounds(shapes: readonly Shape[]): Map<string, Bounds> {
  const byId = new Map(shapes.map((s) => [s.id, s]));
  const out = new Map<string, Bounds>();
  for (const shape of shapes) {
    if (isContainerType(shape.type) || !shape.parentId) continue;
    const box = shapeRotatedBounds(shape);
    const seen = new Set<string>([shape.id]);
    let cur = byId.get(shape.parentId);
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      if (cur.type === 'group') {
        const acc = out.get(cur.id);
        out.set(cur.id, acc ? unionBounds(acc, box) : box);
      }
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
  }
  return out;
}

function expand(b: Bounds, m: number): Bounds {
  return {
    minX: b.minX - m,
    minY: b.minY - m,
    maxX: b.maxX + m,
    maxY: b.maxY + m,
  };
}

/**
 * Is `shape` hidden by a frame ancestor's clip along the swipe segment a-b?
 *
 * A frame masks its descendants to its own rect, so a child parked outside it is
 * invisible — and erasing what cannot be seen is indistinguishable from erasing
 * at random. The swipe only counts against a framed shape where it reaches
 * inside every frame above it. Arrows are exempt for the same reason the
 * renderer exempts them: connectors deliberately escape frame masks so they can
 * span two frames.
 */
function clippedByFrame(
  editor: Editor,
  shape: Shape,
  a: Point,
  b: Point,
  margin: number,
): boolean {
  if (shape.type === 'arrow' || !shape.parentId) return false;
  const seen = new Set<string>([shape.id]);
  let cur = editor.getShape(shape.parentId);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (cur.type === 'frame') {
      const rect = expand(
        {
          minX: cur.x,
          minY: cur.y,
          maxX: cur.x + cur.props.w,
          maxY: cur.y + cur.props.h,
        },
        margin,
      );
      // The mask is the frame's own upright rect; un-rotating the swipe into
      // that frame is cheaper than rotating four corners back out of it.
      const center = { x: cur.x + cur.props.w / 2, y: cur.y + cur.props.h / 2 };
      const la = cur.rotation ? rotatePoint(a, center, -cur.rotation) : a;
      const lb = cur.rotation ? rotatePoint(b, center, -cur.rotation) : b;
      if (!segmentIntersectsBounds(la, lb, rect)) return true;
    }
    cur = cur.parentId ? editor.getShape(cur.parentId) : undefined;
  }
  return false;
}

/**
 * Shapes the swipe segment a→b could plausibly affect — the broad phase.
 *
 * The spatial index narrows thousands of shapes to the handful whose bounds
 * overlap the swipe envelope (the segment's AABB grown by the collision margin),
 * which is what keeps erasing instant on dense canvases. Containers, locked,
 * hidden, frame-clipped and protected shapes are dropped here so neither eraser
 * mode can target them. Callers apply their own narrow-phase test to what comes
 * back.
 */
export function candidatesAlong(
  editor: Editor,
  a: Point,
  b: Point,
  margin: number,
  protectedIds: Set<string>,
): Shape[] {
  const envelope = {
    minX: Math.min(a.x, b.x) - margin,
    minY: Math.min(a.y, b.y) - margin,
    maxX: Math.max(a.x, b.x) + margin,
    maxY: Math.max(a.y, b.y) + margin,
  };
  const out: Shape[] = [];
  for (const id of spatialIndex.search(envelope)) {
    if (protectedIds.has(id)) continue;
    const shape = editor.getShape(id);
    if (!shape || shape.locked || isContainerType(shape.type)) continue;
    // Hidden shapes are invisible — never erase what the user can't see.
    if (!isVisible(shape)) continue;
    if (clippedByFrame(editor, shape, a, b, margin)) continue;
    out.push(shape);
  }
  return out;
}

/**
 * The shape the eraser should actually remove when `shape` is struck: its
 * outermost group ancestor, or `shape` itself when it belongs to no group.
 *
 * A group is one thing to the user — it selects, moves and deletes as a unit —
 * so erasing a member erases the group, exactly as clicking a member selects it
 * (`selectionTargetId`). The climb stops below any group in `excluded`: those
 * are the groups the swipe *started* inside, where the intent is plainly to work
 * on the members rather than throw the container away.
 *
 * Frames are pass-through, matching selection: they are a place shapes live, not
 * a unit that dies with its contents.
 */
export function eraseTargetId(
  editor: Editor,
  shape: Shape,
  excluded: Set<string>,
): string {
  let target = shape.id;
  let cur: Shape | undefined = shape;
  const seen = new Set<string>([shape.id]);
  while (cur?.parentId && !seen.has(cur.parentId)) {
    seen.add(cur.parentId);
    const parent: Shape | undefined = editor.getShape(cur.parentId);
    if (!parent) break;
    if (parent.type === 'group') {
      if (excluded.has(parent.id)) break;
      if (parent.locked) break;
      target = parent.id;
    }
    cur = parent;
  }
  return target;
}

/**
 * Ids of shapes the swipe segment a→b should erase whole.
 *
 * The narrow phase over {@link candidatesAlong}: each candidate runs a
 * geometry-specific collision test in its own local frame, then resolves to the
 * group it is erased as part of.
 */
export function eraseAlong(
  editor: Editor,
  a: Point,
  b: Point,
  margin: number,
  protectedIds: Set<string>,
): string[] {
  const out: string[] = [];
  for (const shape of candidatesAlong(editor, a, b, margin, protectedIds)) {
    const util = shapeRegistry.getFor(shape);
    if (util && segmentErasesShape(shape, util, a, b, margin)) {
      out.push(eraseTargetId(editor, shape, protectedIds));
    }
  }
  return out;
}

/**
 * The single topmost shape the swipe segment a→b should take, or null when it
 * crosses nothing — the accelerator-held variant of {@link eraseAlong}.
 *
 * Erasing normally takes everything the swipe crosses, which is what you want
 * when clearing a region and exactly what you don't want when one drawing sits
 * on another. "Topmost" is by `index`, the fractional z-order key, so it is the
 * shape the user sees on top rather than whichever the spatial index happened to
 * return first. Still segment-based, not point-based: a drag with the modifier
 * held would otherwise step over whatever fell between two samples.
 */
export function eraseTopAlong(
  editor: Editor,
  a: Point,
  b: Point,
  margin: number,
  protectedIds: Set<string>,
): string | null {
  let top: Shape | null = null;
  for (const shape of candidatesAlong(editor, a, b, margin, protectedIds)) {
    if (top && shape.index <= top.index) continue;
    const util = shapeRegistry.getFor(shape);
    if (util && segmentErasesShape(shape, util, a, b, margin)) top = shape;
  }
  return top ? eraseTargetId(editor, top, protectedIds) : null;
}
