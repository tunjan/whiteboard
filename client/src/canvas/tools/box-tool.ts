import type { ComponentType } from 'react';
import {
  genId,
  type RectangleProps,
  type Shape,
} from '@whiteboard/shared';
import { getTopIndex } from '../order';
import { shapeRegistry } from '../shapes/shape-registry';
import { useSelectionStore } from '../use-selection-store';
import { useStyleStore } from '../use-style-store';
import { boxFromDrag } from './drag-box';
import type { Tool, ToolContext, ToolPointerInfo } from './types';

// Below this drag size (world units), a press is treated as a click and the
// shape is given a default size instead of a zero-area one.
const CLICK_THRESHOLD = 4;
const DEFAULT_SIZE = 100;

interface BoxToolOptions {
  id: string;
  type: 'rectangle' | 'ellipse';
  label: string;
  hotkey: string;
  icon: ComponentType<{ className?: string }>;
}

/**
 * Drag-to-create tool shared by rectangle and ellipse (any box-like shape).
 * Keeps a single in-flight creation; one pointer interaction at a time.
 */
export function createBoxTool(opts: BoxToolOptions): Tool {
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
      const style = useStyleStore.getState();
      const props = {
        ...(util.getDefaultProps() as RectangleProps),
        w: 0,
        h: 0,
        color: style.color,
        size: style.size,
        fillStyle: style.fill,
        dash: style.dash,
      };
      const shape = {
        id,
        type: opts.type,
        x: info.point.x,
        y: info.point.y,
        rotation: 0,
        opacity: style.opacity,
        index: getTopIndex(ctx.editor.getShapes()),
        props,
      } as Shape;
      ctx.editor.createShape(shape);
    },

    onPointerMove(info: ToolPointerInfo, ctx: ToolContext) {
      if (!creatingId) return;
      const b = boxFromDrag(start, info.point, info.shiftKey);
      ctx.editor.updateShape(creatingId, {
        x: b.x,
        y: b.y,
        props: { w: b.w, h: b.h },
      });
    },

    onPointerUp(_info: ToolPointerInfo, ctx: ToolContext) {
      const id = creatingId;
      creatingId = null;
      if (!id) return;
      const shape = ctx.editor.getShape(id);
      if (!shape || (shape.type !== 'rectangle' && shape.type !== 'ellipse')) {
        return;
      }
      if (shape.props.w < CLICK_THRESHOLD && shape.props.h < CLICK_THRESHOLD) {
        ctx.editor.updateShape(id, {
          x: start.x - DEFAULT_SIZE / 2,
          y: start.y - DEFAULT_SIZE / 2,
          props: { w: DEFAULT_SIZE, h: DEFAULT_SIZE },
        });
      }
      useSelectionStore.getState().setSelection([id]);
      ctx.complete();
    },
  };
}
