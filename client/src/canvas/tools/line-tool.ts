import type { ComponentType } from 'react';
import { genId, type ArrowProps, type LineProps, type Shape } from '@whiteboard/shared';
import { getTopIndex } from '../order';
import { shapeRegistry } from '../shapes/shape-registry';
import { useCameraStore } from '../use-camera-store';
import { useSelectionStore } from '../use-selection-store';
import { useStyleStore } from '../use-style-store';
import type { Tool, ToolContext, ToolPointerInfo } from './types';

const CLICK_SCREEN_THRESHOLD = 4;

interface LineToolOptions {
  id: string;
  type: 'line' | 'arrow';
  label: string;
  hotkey: string;
  icon: ComponentType<{ className?: string }>;
}

/** Drag-to-create tool shared by line and arrow (two-point polylines). */
export function createLineTool(opts: LineToolOptions): Tool {
  let creatingId: string | null = null;
  let start = { x: 0, y: 0 };

  return {
    id: opts.id,
    label: opts.label,
    hotkey: opts.hotkey,
    icon: opts.icon,
    cursor: 'crosshair',

    onPointerDown(info: ToolPointerInfo, ctx: ToolContext) {
      if (info.button !== 0) return;
      const util = shapeRegistry.get(opts.type);
      if (!util) return;
      start = info.point;
      const id = genId();
      creatingId = id;
      const base = util.getDefaultProps() as LineProps | ArrowProps;
      const style = useStyleStore.getState();
      const shape = {
        id,
        type: opts.type,
        x: start.x,
        y: start.y,
        rotation: 0,
        opacity: style.opacity,
        index: getTopIndex(ctx.editor.getShapes()),
        props: {
          ...base,
          color: style.color,
          size: style.size,
          dash: style.dash,
          // Arrowhead direction only applies to arrows; line props ignore it.
          ...(opts.type === 'arrow'
            ? { arrowStart: style.arrowStart, arrowEnd: style.arrowEnd }
            : {}),
          points: [
            { x: 0, y: 0 },
            { x: 0, y: 0 },
          ],
        },
      } as Shape;
      ctx.editor.createShape(shape);
    },

    onPointerMove(info: ToolPointerInfo, ctx: ToolContext) {
      if (!creatingId) return;
      ctx.editor.updateShape(creatingId, {
        props: {
          points: [
            { x: 0, y: 0 },
            { x: info.point.x - start.x, y: info.point.y - start.y },
          ],
        },
      });
    },

    onPointerUp(info: ToolPointerInfo, ctx: ToolContext) {
      const id = creatingId;
      creatingId = null;
      if (!id) return;
      const z = useCameraStore.getState().camera.z;
      const len = Math.hypot(info.point.x - start.x, info.point.y - start.y);
      // Discard a zero-length click — an empty line/arrow is useless.
      if (len < CLICK_SCREEN_THRESHOLD / z) ctx.editor.deleteShapes([id]);
      else useSelectionStore.getState().setSelection([id]);
      ctx.complete();
    },
  };
}
