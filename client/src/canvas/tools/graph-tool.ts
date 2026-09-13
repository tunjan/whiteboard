import { GraphGlyph } from '@/components/ui/glyphs';
import {
  type Bounds,
  genId,
  type GraphProps,
  type Shape,
} from '@whiteboard/shared';
import { getTopIndex } from '../order';
import { GRAPH_DEFAULT_SIZE } from '../shapes/graph';
import { shapeRegistry } from '../shapes/shape-registry';
import { useSelectionStore } from '../use-selection-store';
import { dragBoxSnapTargets, snappedBoxFromDrag } from './drag-box';
import type { Tool, ToolContext, ToolPointerInfo } from './types';

const CLICK_THRESHOLD = 8;

export function createGraphTool(): Tool {
  let creatingId: string | null = null;
  let start = { x: 0, y: 0 };
  let snapTargets: Bounds[] = [];

  return {
    id: 'graph',
    label: 'Function',
    hotkey: 'g',
    cursor: 'crosshair',
    icon: GraphGlyph,

    onPointerDown(info: ToolPointerInfo, ctx: ToolContext) {
      if (info.button !== 0) return;
      const util = shapeRegistry.get('graph');
      if (!util) return;

      start = info.point;
      const id = genId();
      creatingId = id;
      const props: GraphProps = {
        ...(util.getDefaultProps() as GraphProps),
        w: 0,
        h: 0,
      };
      const shape = {
        id,
        type: 'graph',
        x: info.point.x,
        y: info.point.y,
        rotation: 0,
        index: getTopIndex(ctx.editor.getShapes()),
        props,
      } as Shape;
      ctx.editor.createShape(shape);
      snapTargets = dragBoxSnapTargets(ctx, id, info.point);
    },

    onPointerMove(info: ToolPointerInfo, ctx: ToolContext) {
      if (!creatingId) return;
      const b = snappedBoxFromDrag(start, info, snapTargets);
      ctx.editor.updateShape(creatingId, {
        x: b.x,
        y: b.y,
        props: { w: b.w, h: b.h },
      });
    },

    onPointerUp(_info: ToolPointerInfo, ctx: ToolContext) {
      const id = creatingId;
      creatingId = null;
      snapTargets = [];
      useSelectionStore.getState().setSnapGuides([]);
      if (!id) return;
      const shape = ctx.editor.getShape(id);
      if (!shape || shape.type !== 'graph') return;

      if (shape.props.w < CLICK_THRESHOLD && shape.props.h < CLICK_THRESHOLD) {
        ctx.editor.updateShape(id, {
          x: start.x - GRAPH_DEFAULT_SIZE.w / 2,
          y: start.y - GRAPH_DEFAULT_SIZE.h / 2,
          props: { w: GRAPH_DEFAULT_SIZE.w, h: GRAPH_DEFAULT_SIZE.h },
        });
      }

      useSelectionStore.getState().setSelection([id]);
      ctx.complete();
    },

    // Pinch-to-zoom mid-create: drop the in-flight graph, stay in the tool.
    onCancel(ctx: ToolContext) {
      const id = creatingId;
      creatingId = null;
      snapTargets = [];
      useSelectionStore.getState().setSnapGuides([]);
      if (id) ctx.editor.deleteShapes([id]);
    },
  };
}
