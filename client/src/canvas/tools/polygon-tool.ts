import { Shapes } from 'lucide-react';
import { genId, type PolygonProps, type Shape } from '@whiteboard/shared';
import { getTopIndex } from '../order';
import { shapeRegistry } from '../shapes/shape-registry';
import { useSelectionStore } from '../use-selection-store';
import { useStyleStore } from '../use-style-store';
import { boxFromDrag } from './drag-box';
import type { Tool, ToolContext, ToolPointerInfo } from './types';

const CLICK_THRESHOLD = 4;
const DEFAULT_SIZE = 100;

/**
 * Drag-to-create tool for polygons. The kind comes from the style store (set via
 * the toolbar's shapes menu). Hidden from the toolbar's flat button list.
 */
export function createPolygonTool(): Tool {
  let creatingId: string | null = null;
  let start = { x: 0, y: 0 };

  return {
    id: 'polygon',
    label: 'Polygon',
    cursor: 'crosshair',
    icon: Shapes,
    hidden: true,

    onPointerDown(info: ToolPointerInfo, ctx: ToolContext) {
      if (info.button !== 0) return;
      const util = shapeRegistry.get('polygon');
      if (!util) return;
      start = info.point;
      const id = genId();
      creatingId = id;
      const style = useStyleStore.getState();
      const props: PolygonProps = {
        ...(util.getDefaultProps() as PolygonProps),
        w: 0,
        h: 0,
        kind: style.polygonKind,
        color: style.color,
        size: style.size,
        fillStyle: style.fill,
        dash: style.dash,
      };
      ctx.editor.createShape({
        id,
        type: 'polygon',
        x: info.point.x,
        y: info.point.y,
        rotation: 0,
        opacity: style.opacity,
        index: getTopIndex(ctx.editor.getShapes()),
        props,
      } as Shape);
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
      if (shape?.type !== 'polygon') return;
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
