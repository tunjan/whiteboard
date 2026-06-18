import { Eraser } from 'lucide-react';
import type { Point } from '@whiteboard/shared';
import { useCameraStore } from '../use-camera-store';
import { useEraserStore } from '../use-eraser-store';
import { eraseAlong, protectedAt } from './erase';
import type { Tool, ToolContext, ToolPointerInfo } from './types';

/** Collision radius in screen pixels; scaled to world units by the zoom level. */
const ERASER_SCREEN_RADIUS = 8;

/**
 * Two-phase swipe eraser. While the pointer is down, shapes the swipe crosses
 * are added to a pending queue and rendered faded (the highlight phase) rather
 * than deleted. On release the whole queue is removed in one batched command, so
 * a single undo restores the entire stroke. Escaping or switching tools mid-
 * stroke discards the queue and restores every highlighted shape. The tool stays
 * active after a stroke for repeated erasing.
 */
export function createEraserTool(): Tool {
  let erasing = false;
  let last: Point | null = null;
  /** Backgrounds (containers/text) under the start point, spared all stroke. */
  let protectedIds = new Set<string>();
  /** Accumulated queue of shape ids to delete on release. */
  const queue = new Set<string>();

  /** End the stroke, clearing transient state and the highlight. */
  function reset() {
    erasing = false;
    last = null;
    protectedIds = new Set();
    queue.clear();
    useEraserStore.getState().clear();
  }

  function margin(): number {
    return ERASER_SCREEN_RADIUS / useCameraStore.getState().camera.z;
  }

  function extend(editor: ToolContext['editor'], from: Point, to: Point) {
    for (const id of eraseAlong(editor, from, to, margin(), protectedIds)) {
      queue.add(id);
    }
    useEraserStore.getState().set([...queue]);
  }

  return {
    id: 'eraser',
    label: 'Eraser',
    hotkey: 'e',
    cursor: 'crosshair',
    icon: Eraser,

    onPointerDown(info: ToolPointerInfo, ctx: ToolContext) {
      if (info.button !== 0) return;
      erasing = true;
      last = info.point;
      protectedIds = protectedAt(ctx.editor, info.point, margin());
      queue.clear();
      // A click with no drag still erases what's under the cursor.
      extend(ctx.editor, info.point, info.point);
    },

    onPointerMove(info: ToolPointerInfo, ctx: ToolContext) {
      if (!erasing) return;
      const from = last ?? info.point;
      extend(ctx.editor, from, info.point);
      last = info.point;
    },

    onPointerUp(_info: ToolPointerInfo, ctx: ToolContext) {
      if (!erasing) return;
      const ids = [...queue];
      // One batched delete = one undo step for the whole erase stroke.
      if (ids.length) ctx.editor.deleteShapes(ids);
      reset();
    },

    // Escape / tool switch / pinch mid-stroke cancels: the highlighted shapes
    // revert and nothing is deleted.
    onExit() {
      reset();
    },
    onCancel() {
      reset();
    },
  };
}
