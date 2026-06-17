import { Eraser } from 'lucide-react';
import type { Point } from '@whiteboard/shared';
import { useCameraStore } from '../use-camera-store';
import { eraseAtPoint } from './erase';
import type { Tool, ToolContext, ToolPointerInfo } from './types';

const SAMPLE_SCREEN_STEP = 4;

/**
 * Destructive eraser. Erases on contact and samples along fast drags so nothing
 * is skipped between move events. Stays active after a stroke.
 */
export function createEraserTool(): Tool {
  let erasing = false;
  let last: Point | null = null;

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
      eraseAtPoint(ctx.editor, info.point);
    },

    onPointerMove(info: ToolPointerInfo, ctx: ToolContext) {
      if (!erasing) return;
      const from = last ?? info.point;
      const step = SAMPLE_SCREEN_STEP / useCameraStore.getState().camera.z;
      const dx = info.point.x - from.x;
      const dy = info.point.y - from.y;
      const dist = Math.hypot(dx, dy);
      const n = Math.max(1, Math.floor(dist / step));
      for (let i = 1; i <= n; i++) {
        eraseAtPoint(ctx.editor, {
          x: from.x + (dx * i) / n,
          y: from.y + (dy * i) / n,
        });
      }
      last = info.point;
    },

    onPointerUp() {
      erasing = false;
      last = null;
    },
  };
}
