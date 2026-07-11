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

  // Finish the in-flight line/arrow. Shared by pointer-up (normal finish) and
  // commit (OS reclaimed the pointer mid-create — keep what was drawn). Length is
  // read from the shape's own endpoints so it works without a pointer position.
  function finalize(ctx: ToolContext): void {
    const id = creatingId;
    creatingId = null;
    if (!id) return;
    const shape = ctx.editor.getShape(id);
    const z = useCameraStore.getState().camera.z;
    let len = 0;
    if (shape && (shape.type === 'line' || shape.type === 'arrow')) {
      const pts = shape.props.points;
      const a = pts[0];
      const b = pts[pts.length - 1];
      if (a && b) len = Math.hypot(b.x - a.x, b.y - a.y);
    }
    // Discard a zero-length click — an empty line/arrow is useless.
    if (len < CLICK_SCREEN_THRESHOLD / z) ctx.editor.deleteShapes([id]);
    else useSelectionStore.getState().setSelection([id]);
    ctx.complete();
  }

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
      let dx = info.point.x - start.x;
      let dy = info.point.y - start.y;
      // Hold Shift to lock the line/arrow to perfectly horizontal or vertical,
      // whichever axis the drag is closer to.
      if (info.shiftKey) {
        if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      ctx.editor.updateShape(creatingId, {
        props: {
          points: [
            { x: 0, y: 0 },
            { x: dx, y: dy },
          ],
        },
      });
    },

    onPointerUp(_info: ToolPointerInfo, ctx: ToolContext) {
      finalize(ctx);
    },

    // The OS reclaimed the pointer mid-create (spurious pointercancel /
    // lostpointercapture). Keep the line drawn so far rather than discarding it.
    onCommit(ctx: ToolContext) {
      finalize(ctx);
    },

    // Pinch-to-zoom mid-create: drop the in-flight shape, stay in the tool.
    onCancel(ctx: ToolContext) {
      const id = creatingId;
      creatingId = null;
      if (id) ctx.editor.deleteShapes([id]);
    },
  };
}
