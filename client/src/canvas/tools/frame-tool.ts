import { Frame } from 'lucide-react';
import { genId, type FrameProps, type Shape } from '@whiteboard/shared';
import { getBottomIndex } from '../order';
import { shapeRegistry } from '../shapes/shape-registry';
import { useSelectionStore } from '../use-selection-store';
import { useStyleStore } from '../use-style-store';
import { boxFromDrag } from './drag-box';
import type { Tool, ToolContext, ToolPointerInfo } from './types';

const CLICK_THRESHOLD = 8;
const DEFAULT_W = 320;
const DEFAULT_H = 240;

/**
 * Frame tool: drag out a frame. Shapes fully inside the new frame are captured
 * as its children (and will clip to it). Frames sit at the back so their
 * background doesn't cover unrelated shapes.
 */
export function createFrameTool(): Tool {
  let creatingId: string | null = null;
  let start = { x: 0, y: 0 };

  return {
    id: 'frame',
    label: 'Frame',
    hotkey: 'f',
    cursor: 'crosshair',
    icon: Frame,

    onPointerDown(info: ToolPointerInfo, ctx: ToolContext) {
      if (info.button !== 0) return;
      const util = shapeRegistry.get('frame');
      if (!util) return;
      start = info.point;
      const id = genId();
      creatingId = id;
      const count = ctx.editor.getShapes().filter((s) => s.type === 'frame').length;
      const props: FrameProps = {
        ...(util.getDefaultProps() as FrameProps),
        w: 0,
        h: 0,
        name: `Frame ${count + 1}`,
      };
      const shape = {
        id,
        type: 'frame',
        x: info.point.x,
        y: info.point.y,
        rotation: 0,
        opacity: useStyleStore.getState().opacity,
        index: getBottomIndex(ctx.editor.getShapes()),
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
      const frame = ctx.editor.getShape(id);
      if (!frame || frame.type !== 'frame') return;

      if (frame.props.w < CLICK_THRESHOLD && frame.props.h < CLICK_THRESHOLD) {
        ctx.editor.updateShape(id, {
          x: start.x,
          y: start.y,
          props: { w: DEFAULT_W, h: DEFAULT_H },
        });
      }

      // Capture top-level shapes fully inside the frame.
      const fr = ctx.editor.getShape(id);
      if (fr && fr.type === 'frame') {
        const rect = {
          minX: fr.x,
          minY: fr.y,
          maxX: fr.x + fr.props.w,
          maxY: fr.y + fr.props.h,
        };
        for (const s of ctx.editor.getShapes()) {
          if (s.id === id || s.parentId || s.type === 'frame' || s.type === 'group') {
            continue;
          }
          const util = shapeRegistry.getFor(s);
          if (!util) continue;
          const b = util.getBounds(s);
          if (
            b.minX >= rect.minX &&
            b.maxX <= rect.maxX &&
            b.minY >= rect.minY &&
            b.maxY <= rect.maxY
          ) {
            ctx.editor.updateShape(s.id, { parentId: id });
          }
        }
      }

      useSelectionStore.getState().setSelection([id]);
      ctx.complete();
    },

    // Pinch-to-zoom mid-create: drop the in-flight frame, stay in the tool.
    onCancel(ctx: ToolContext) {
      const id = creatingId;
      creatingId = null;
      if (id) ctx.editor.deleteShapes([id]);
    },
  };
}
