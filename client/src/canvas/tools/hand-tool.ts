import { stopFollowingForManualCameraChange } from '@/collab/use-follow-store';
import { useCameraStore } from '../use-camera-store';
import { setHandDragging } from '../use-camera-interaction';
import { HandToolIcon } from './hand-tool-icon';
import type { Tool, ToolPointerInfo } from './types';

/**
 * Hand tool: drag anywhere to pan the camera. Works with mouse, pen, and a
 * single finger (touch routes one-finger drags to the active tool). Mirrors the
 * space-to-pan gesture, just made explicit as a selectable tool.
 */
export function createHandTool(): Tool {
  let last: { x: number; y: number } | null = null;
  const finishDrag = () => {
    last = null;
    setHandDragging(false);
  };

  return {
    id: 'hand',
    label: 'Pan',
    hotkey: 'h',
    cursor: 'grab',
    icon: HandToolIcon,

    onPointerDown(info: ToolPointerInfo) {
      if (info.button !== 0) {
        finishDrag();
        return;
      }
      last = info.screenPoint;
      setHandDragging(true);
      stopFollowingForManualCameraChange();
    },

    onPointerMove(info: ToolPointerInfo) {
      if (!last) return;
      const dx = info.screenPoint.x - last.x;
      const dy = info.screenPoint.y - last.y;
      last = info.screenPoint;
      if (dx === 0 && dy === 0) return;
      // Drag right -> camera moves left so content follows the cursor.
      useCameraStore.getState().panByScreen(-dx, -dy);
    },

    onPointerUp() {
      finishDrag();
    },

    onCancel() {
      finishDrag();
    },

    onExit() {
      finishDrag();
    },
  };
}
