import { stopFollowingForManualCameraChange } from '@/collab/use-follow-store';
import { InputsManager } from '../inputs-manager';
import { useCameraStore } from '../use-camera-store';
import { setHandDragging } from '../use-camera-interaction';
import { HandToolIcon } from './hand-tool-icon';
import type { Tool, ToolPointerInfo } from './types';

/**
 * Hand tool: drag anywhere to pan the camera. Works with mouse, pen, and a
 * single finger (touch routes one-finger drags to the active tool). Mirrors the
 * space-to-pan gesture, just made explicit as a selectable tool — including its
 * inertia: letting go mid-throw coasts the camera to a stop.
 */
export function createHandTool(): Tool {
  let last: { x: number; y: number } | null = null;
  const inputs = new InputsManager();
  const finishDrag = () => {
    last = null;
    inputs.reset();
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
      useCameraStore.getState().stopCameraAnimation();
      last = info.screenPoint;
      inputs.reset(info.screenPoint, info.timestamp);
      setHandDragging(true);
      stopFollowingForManualCameraChange();
    },

    onPointerMove(info: ToolPointerInfo) {
      if (!last || info.isCameraMove) return;
      const dx = info.screenPoint.x - last.x;
      const dy = info.screenPoint.y - last.y;
      last = info.screenPoint;
      inputs.update(info.screenPoint, info.timestamp);
      if (dx === 0 && dy === 0) return;
      // Drag right -> camera moves left so content follows the cursor.
      useCameraStore.getState().panByScreen(-dx, -dy);
    },

    onPointerUp(info: ToolPointerInfo) {
      if (!last) return;
      // The release sample first, so a drag that came to rest before lifting
      // does not throw on a velocity it no longer has.
      const velocity = inputs.update(info.screenPoint, info.timestamp);
      finishDrag();
      useCameraStore.getState().slideCamera(velocity);
    },

    onCancel() {
      finishDrag();
    },

    onExit() {
      finishDrag();
    },
  };
}
