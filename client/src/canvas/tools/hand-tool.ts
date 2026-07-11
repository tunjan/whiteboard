import { Hand } from 'lucide-react';
import { stopFollowingForManualCameraChange } from '@/collab/use-follow-store';
import { useCameraStore } from '../use-camera-store';
import type { Tool, ToolPointerInfo } from './types';

/**
 * Hand tool: drag anywhere to pan the camera. Works with mouse, pen, and a
 * single finger (touch routes one-finger drags to the active tool). Mirrors the
 * space-to-pan gesture, just made explicit as a selectable tool.
 */
export function createHandTool(): Tool {
  let last: { x: number; y: number } | null = null;

  return {
    id: 'hand',
    label: 'Hand',
    hotkey: 'h',
    cursor: 'grab',
    icon: Hand,

    onPointerDown(info: ToolPointerInfo) {
      last = info.screenPoint;
      stopFollowingForManualCameraChange();
    },

    onPointerMove(info: ToolPointerInfo) {
      if (!last) return;
      const dx = info.screenPoint.x - last.x;
      const dy = info.screenPoint.y - last.y;
      last = info.screenPoint;
      // Drag right -> camera moves left so content follows the cursor.
      useCameraStore.getState().panByScreen(-dx, -dy);
    },

    onPointerUp() {
      last = null;
    },

    onCancel() {
      last = null;
    },
  };
}
