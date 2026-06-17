import { ChartLine } from 'lucide-react';
import { genId, type PlotProps, type Shape } from '@whiteboard/shared';
import { getTopIndex } from '../order';
import { shapeRegistry } from '../shapes/shape-registry';
import { useSelectionStore } from '../use-selection-store';
import { boxFromDrag } from './drag-box';
import type { Tool, ToolContext, ToolPointerInfo } from './types';

const CLICK_THRESHOLD = 8;
const DEFAULT_W = 360;
const DEFAULT_H = 260;

export function createPlotTool(): Tool {
  let creatingId: string | null = null;
  let start = { x: 0, y: 0 };

  return {
    id: 'plot',
    label: 'Plot',
    hotkey: 'p',
    cursor: 'crosshair',
    icon: ChartLine,

    onPointerDown(info: ToolPointerInfo, ctx: ToolContext) {
      if (info.button !== 0) return;
      const util = shapeRegistry.get('plot');
      if (!util) return;
      start = info.point;
      const id = genId();
      creatingId = id;
      const props: PlotProps = {
        ...(util.getDefaultProps() as PlotProps),
        w: 0,
        h: 0,
      };
      const shape = {
        id,
        type: 'plot',
        x: info.point.x,
        y: info.point.y,
        rotation: 0,
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
      if (!shape || shape.type !== 'plot') return;
      if (shape.props.w < CLICK_THRESHOLD && shape.props.h < CLICK_THRESHOLD) {
        ctx.editor.updateShape(id, {
          x: start.x - DEFAULT_W / 2,
          y: start.y - DEFAULT_H / 2,
          props: { w: DEFAULT_W, h: DEFAULT_H },
        });
      }
      useSelectionStore.getState().setSelection([id]);
      ctx.complete();
    },
  };
}
