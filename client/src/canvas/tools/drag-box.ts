import type { Point } from '@whiteboard/shared';
import { getSnapGridStep } from '../grid';
import { SNAP_SCREEN, snapRegion, snapTargetBounds } from '../snap-targets';
import {
  type BoundsSnapTarget,
  type BoundsSnapTargetLike,
  snapResizeBounds,
} from '../snapping';
import { useCameraStore } from '../use-camera-store';
import { useCanvasUiStore } from '../use-canvas-ui-store';
import { useSelectionStore } from '../use-selection-store';
import type { ToolContext, ToolPointerInfo } from './types';

export interface DragBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Box from a drag between `start` and `point`. With `lockAspect` (Shift), the
 * box is squared — drawing a square / circle / regular polygon.
 */
export function boxFromDrag(
  start: Point,
  point: Point,
  lockAspect: boolean,
): DragBox {
  const dx = point.x - start.x;
  const dy = point.y - start.y;
  let w = Math.abs(dx);
  let h = Math.abs(dy);
  if (lockAspect) {
    const s = Math.max(w, h);
    w = s;
    h = s;
  }
  return {
    x: dx < 0 ? start.x - w : start.x,
    y: dy < 0 ? start.y - h : start.y,
    w,
    h,
  };
}

/**
 * Snap candidates for a drag-to-create gesture. Collected once at pointer-down:
 * the region is the viewport, which the drag does not change.
 */
export function dragBoxSnapTargets(
  ctx: ToolContext,
  creatingId: string,
  at: Point,
): BoundsSnapTarget[] {
  return snapTargetBounds(
    ctx.editor,
    new Set([creatingId]),
    null,
    snapRegion(ctx, { minX: at.x, minY: at.y, maxX: at.x, maxY: at.y }),
  );
}

/**
 * `boxFromDrag` with the dragged corner snapped to nearby shapes and the grid,
 * publishing the guides. The pressed corner is the anchor and stays put, so this
 * is the same problem as dragging that resize handle. Alt bypasses snapping.
 */
export function snappedBoxFromDrag(
  start: Point,
  info: ToolPointerInfo,
  targets: BoundsSnapTargetLike[],
): DragBox {
  const box = boxFromDrag(start, info.point, info.shiftKey);
  const selection = useSelectionStore.getState();
  if (info.altKey || !useCanvasUiStore.getState().snappingEnabled) {
    selection.setSnapGuides([]);
    return box;
  }
  const camera = useCameraStore.getState().camera;
  const handle =
    (info.point.y < start.y ? 'n' : 's') + (info.point.x < start.x ? 'w' : 'e');
  const snapped = snapResizeBounds(
    { minX: box.x, minY: box.y, maxX: box.x + box.w, maxY: box.y + box.h },
    handle,
    targets,
    info.metaKey || info.ctrlKey
      ? null
      : getSnapGridStep(useCanvasUiStore.getState().background, camera),
    SNAP_SCREEN / camera.z,
    info.shiftKey,
    1,
  );
  selection.setSnapGuides(snapped.guides);
  return {
    x: snapped.bounds.minX,
    y: snapped.bounds.minY,
    w: snapped.bounds.maxX - snapped.bounds.minX,
    h: snapped.bounds.maxY - snapped.bounds.minY,
  };
}
