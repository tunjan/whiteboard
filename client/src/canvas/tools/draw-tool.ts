import { Pencil } from 'lucide-react';
import { genId, type DrawPoint, type DrawProps, type Shape } from '@whiteboard/shared';
import { getTopIndex } from '../order';
import {
  DEFAULT_PENCIL_DYNAMICS,
  pencilStabilizationToStreamline,
} from '../shapes/ink';
import { shapeRegistry } from '../shapes/shape-registry';
import { useCanvasUiStore } from '../use-canvas-ui-store';
import { useStyleStore } from '../use-style-store';
import type { Tool, ToolContext, ToolPointerInfo } from './types';

/**
 * Freehand pen. Builds a draw shape point-by-point and leaves stroke cleanup to
 * the ink renderer so velocity and pressure dynamics stay intact.
 * Critically, on pointer-up it stays in the draw tool and does NOT select the
 * new stroke — no selection rectangle appears, so the user can keep drawing.
 */
export function createDrawTool(): Tool {
  let id: string | null = null;
  let origin = { x: 0, y: 0 };
  let points: DrawPoint[] = [];

  const appendPoint = (info: ToolPointerInfo): boolean => {
    const local = {
      x: info.point.x - origin.x,
      y: info.point.y - origin.y,
      pressure: info.pressure,
    };
    const last = points[points.length - 1];
    if (
      last &&
      last.x === local.x &&
      last.y === local.y &&
      last.pressure === local.pressure
    ) {
      return false;
    }
    points.push(local);
    return true;
  };

  return {
    id: 'draw',
    label: 'Draw',
    hotkey: 'd',
    cursor: 'crosshair',
    icon: Pencil,

    onPointerDown(info: ToolPointerInfo, ctx: ToolContext) {
      if (info.button !== 0) return;
      const util = shapeRegistry.get('draw');
      if (!util) return;
      origin = info.point;
      points = [{ x: 0, y: 0, pressure: info.pressure }];
      const simulatePressure = info.pointerType !== 'pen';
      const streamline = pencilStabilizationToStreamline(
        useCanvasUiStore.getState().pencilStabilization,
      );
      const sid = genId();
      id = sid;
      const shape = {
        id: sid,
        type: 'draw',
        x: origin.x,
        y: origin.y,
        rotation: 0,
        opacity: useStyleStore.getState().opacity,
        index: getTopIndex(ctx.editor.getShapes()),
        props: {
          ...(util.getDefaultProps() as DrawProps),
          points: points.slice(),
          color: useStyleStore.getState().color,
          size: useStyleStore.getState().size,
          ...DEFAULT_PENCIL_DYNAMICS,
          simulatePressure,
          streamline,
        },
      } as Shape;
      ctx.editor.createShape(shape);
    },

    onPointerMove(info: ToolPointerInfo, ctx: ToolContext) {
      if (!id) return;
      if (appendPoint(info)) {
        ctx.editor.updateShape(id, { props: { points: points.slice() } });
      }
    },

    onPointerUp(info: ToolPointerInfo, ctx: ToolContext) {
      const sid = id;
      id = null;
      if (!sid) return;
      appendPoint(info);
      ctx.editor.updateShape(sid, { props: { points: points.slice() } });
      points = [];
      // Stay in the draw tool; intentionally no selection of the new stroke.
    },

    // A pinch (or tool switch) mid-stroke discards the partial stroke entirely.
    onCancel(ctx: ToolContext) {
      const sid = id;
      id = null;
      points = [];
      if (sid) ctx.editor.deleteShapes([sid]);
    },
  };
}
