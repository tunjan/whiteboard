import type { Bounds, Shape } from '@whiteboard/shared';
import { isVisible } from './selectable';
import { shapeRegistry } from './shapes/shape-registry';
import { shapeBoundsSnapPoints } from './snap-geometry';
import type { BoundsSnapTarget } from './snapping';
import { spatialIndex } from './use-document-store';
import { useCanvasUiStore } from './use-canvas-ui-store';
import type { Editor } from './editor';
import type { ToolContext } from './tools/types';

/** Snap threshold in screen px (divided by zoom for world distance). */
export const SNAP_SCREEN = 8;

/**
 * The shape that stands in for `id` when the drag is scoped to `ancestor`: walk
 * up to `ancestor`'s own child, keeping the outermost frame met along the way
 * (a frame snaps as one box, its contents stay private) while groups pass
 * through to the leaf that carries the geometry. Null when `id` lives outside
 * the `ancestor` subtree, which is what keeps another frame's contents from
 * guiding a drag that happens elsewhere.
 */
function scopedTarget(
  editor: Editor,
  id: string,
  ancestor: string | null,
): string | null {
  let current = editor.getShape(id);
  let target = id;
  const guard = new Set<string>();
  while (current && !guard.has(current.id)) {
    guard.add(current.id);
    const parentId = current.parentId ?? null;
    if (parentId === ancestor) return target;
    if (!parentId) return null;
    const parent = editor.getShape(parentId);
    if (!parent) return null;
    if (parent.type === 'frame') target = parent.id;
    current = parent;
  }
  return null;
}

/**
 * Visible, non-moving shapes in the viewport that permit snapping, restricted to
 * the container the drag happens in (`ancestor`, null for the page root). The
 * container itself is a target too, so a shape dragged inside a frame can line
 * up with the frame's own edges.
 */
export function snapTargetShapes(
  editor: Editor,
  movingIds: Set<string>,
  ancestor: string | null,
  region: Bounds,
): Shape[] {
  if (!useCanvasUiStore.getState().snappingEnabled) return [];
  const targets: Shape[] = [];
  const seen = new Set<string>();
  const add = (id: string) => {
    if (movingIds.has(id) || seen.has(id)) return;
    seen.add(id);
    const shape = editor.getShape(id);
    if (!shape || !isVisible(shape)) return;
    const util = shapeRegistry.getFor(shape);
    // Groups have no box of their own; their leaves stand in for them.
    if (!util || util.canSnap === false || shape.type === 'group') return;
    targets.push(shape);
  };

  if (ancestor) add(ancestor);
  for (const id of spatialIndex.search(region)) {
    if (movingIds.has(id)) continue;
    const scoped = scopedTarget(editor, id, ancestor);
    if (scoped) add(scoped);
  }
  return targets;
}

export function snapRegion(ctx: ToolContext, fallback: Bounds): Bounds {
  return ctx.getViewportBounds?.() ?? spatialIndex.totalBounds() ?? fallback;
}

export function snapTargetBounds(
  editor: Editor,
  movingIds: Set<string>,
  ancestor: string | null,
  region: Bounds,
): BoundsSnapTarget[] {
  return snapTargetShapes(editor, movingIds, ancestor, region).flatMap(
    (shape) => {
      const bounds = spatialIndex.getBounds(shape.id);
      const points = shapeBoundsSnapPoints(shape);
      return bounds && points ? [{ ...bounds, points }] : [];
    },
  );
}
