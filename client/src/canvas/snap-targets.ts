import type { Bounds, Shape } from '@whiteboard/shared';
import { isVisible } from './selectable';
import { shapeRegistry } from './shapes/shape-registry';
import { spatialIndex } from './use-document-store';
import { useCanvasUiStore } from './use-canvas-ui-store';
import type { Editor } from './editor';
import type { ToolContext } from './tools/types';

/** Snap threshold in screen px (divided by zoom for world distance). */
export const SNAP_SCREEN = 8;

/** Visible, non-moving shapes in the viewport that permit snapping. */
export function snapTargetShapes(
  editor: Editor,
  movingIds: Set<string>,
  region: Bounds,
): Shape[] {
  if (!useCanvasUiStore.getState().snappingEnabled) return [];
  const targets: Shape[] = [];
  for (const id of spatialIndex.search(region)) {
    if (movingIds.has(id)) continue;
    const shape = editor.getShape(id);
    if (!shape || !isVisible(shape)) continue;
    const util = shapeRegistry.getFor(shape);
    if (!util || util.canSnap === false || shape.type === 'group') continue;
    targets.push(shape);
  }
  return targets;
}

export function snapRegion(ctx: ToolContext, fallback: Bounds): Bounds {
  return ctx.getViewportBounds?.() ?? spatialIndex.totalBounds() ?? fallback;
}

export function snapTargetBounds(
  editor: Editor,
  movingIds: Set<string>,
  region: Bounds,
): Bounds[] {
  return snapTargetShapes(editor, movingIds, region).flatMap((shape) => {
    const bounds = spatialIndex.getBounds(shape.id);
    return bounds ? [bounds] : [];
  });
}
