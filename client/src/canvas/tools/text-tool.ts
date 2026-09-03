import { Type } from 'lucide-react';
import { genId, type Point, type Shape, type TextProps } from '@whiteboard/shared';
import { getSnapGridStep, snapCoordinateToGrid } from '../grid';
import { getTopIndex } from '../order';
import { shapeRegistry } from '../shapes/shape-registry';
import { textIndexAtWorldPoint } from '../shapes/text';
import {
  MIN_TEXT_WIDTH,
  layoutTextProps,
  resolveLineHeightPx,
  textAlignOffset,
  textLineHeight,
} from '../shapes/text-measure';
import { useCameraStore } from '../use-camera-store';
import { useCanvasUiStore } from '../use-canvas-ui-store';
import { useSelectionStore } from '../use-selection-store';
import { groupStyle, useStyleStore } from '../use-style-store';
import { useTextEditingStore } from '../use-text-editing-store';
import type { Tool, ToolContext, ToolPointerInfo } from './types';

// A press only becomes a fixed-width box once it has travelled horizontally
// past this many screen pixels — the same base distance the engine uses to
// separate a click from a drag, widened because the two outcomes here are very
// different and a wrong guess costs the user a re-do. Touch gets more room: a
// finger rolls further than a mouse does on the way down.
const DRAG_BASE_PX = 4;
const COARSE_DRAG_BASE_PX = 6;
const DRAG_DISTANCE_MULTIPLIER = 6;

// ...and only after the press has been held this long. Without the delay, a
// fast click that happens to skid sideways would open a box instead of a caret.
const DRAG_HOLD_MS = 150;

/**
 * Text tool. Clicking an existing text edits it. On empty canvas a click
 * creates an auto-sizing text that grows with its content, while a horizontal
 * drag creates a fixed-width box whose text wraps inside the width drawn.
 * Either way the tool switches to select afterward, so a stray click doesn't
 * spawn another text while the editor overlay is open.
 */
export function createTextTool(): Tool {
  // Set on pointer down and cleared once the press resolves. `creatingId` stays
  // null until a drag crosses both gates, so it doubles as "this gesture has
  // already committed to being a box".
  let pending: { origin: Point; time: number } | null = null;
  let creatingId: string | null = null;

  /** Active grid step in world units, or null when nothing is snapping. */
  function gridStep(): number | null {
    const ui = useCanvasUiStore.getState();
    if (!ui.snappingEnabled) return null;
    return getSnapGridStep(ui.background, useCameraStore.getState().camera);
  }

  function styledProps(): TextProps {
    const util = shapeRegistry.get('text');
    const style = useStyleStore.getState();
    return {
      ...(util?.getDefaultProps() as TextProps),
      color: groupStyle('text').color,
      fontFamily: style.fontFamily,
      fontWeight: style.fontWeight,
      align: style.align,
    };
  }

  /**
   * Top-left corner for a text whose first line should sit on `origin`.
   * Auto-sized text is also pulled sideways so that `origin` lands on whichever
   * edge the alignment makes the visually anchored one.
   */
  function placeAt(
    origin: Point,
    props: TextProps,
    width: number | null,
  ): Point {
    const halfLine =
      resolveLineHeightPx(props.fontSize, textLineHeight(props)) / 2;
    let x =
      width === null
        ? origin.x + textAlignOffset(layoutTextProps(props).width, props.align)
        : origin.x;
    let y = origin.y - halfLine;

    const step = gridStep();
    if (step) {
      x = snapCoordinateToGrid(x, step);
      y = snapCoordinateToGrid(y, step);
    }
    return { x, y };
  }

  /** `width` null creates an auto-sizing text; a number creates a wrap box. */
  function create(
    ctx: ToolContext,
    origin: Point,
    props: TextProps,
    width: number | null,
  ): string {
    const id = genId();
    const { x, y } = placeAt(origin, props, width);
    ctx.editor.createShape({
      id,
      type: 'text',
      x,
      y,
      rotation: 0,
      opacity: groupStyle('text').opacity,
      index: getTopIndex(ctx.editor.getShapes()),
      props:
        width === null
          ? props
          : { ...props, sizingMode: 'fixed', width },
    } as Shape);
    return id;
  }

  function edit(ctx: ToolContext, id: string, caret: number): void {
    useSelectionStore.getState().setSelection([id]);
    useTextEditingStore.getState().start(id, { anchor: caret, head: caret });
    ctx.setTool('select');
  }

  return {
    id: 'text',
    label: 'Text',
    hotkey: 't',
    cursor: 'text',
    icon: Type,

    onPointerDown(info: ToolPointerInfo, ctx: ToolContext) {
      if (info.button !== 0) return;
      const tol = 4 / useCameraStore.getState().camera.z;
      const shapes = ctx.editor.getShapes();

      // Edit the topmost text under the pointer, if any.
      for (let i = shapes.length - 1; i >= 0; i--) {
        const s = shapes[i]!;
        if (s.type !== 'text') continue;
        const util = shapeRegistry.getFor(s);
        if (util?.hitTest(s, info.point, tol)) {
          edit(ctx, s.id, textIndexAtWorldPoint(s, info.point));
          return;
        }
      }

      // Otherwise wait: only the rest of the gesture says whether this is a
      // caret placement or a box being drawn.
      pending = { origin: info.point, time: info.timestamp };
      creatingId = null;
    },

    onPointerMove(info: ToolPointerInfo, ctx: ToolContext) {
      if (!pending) return;

      if (!creatingId) {
        if (info.timestamp - pending.time < DRAG_HOLD_MS) return;
        const base =
          info.pointerType === 'touch' ? COARSE_DRAG_BASE_PX : DRAG_BASE_PX;
        const threshold = (base * DRAG_DISTANCE_MULTIPLIER) / info.zoom;
        if (Math.abs(info.point.x - pending.origin.x) <= threshold) return;
        creatingId = create(ctx, pending.origin, styledProps(), MIN_TEXT_WIDTH);
        useSelectionStore.getState().setSelection([creatingId]);
      }

      const shape = ctx.editor.getShape(creatingId);
      if (shape?.type !== 'text') return;
      // Dragging back past the origin grows the box leftward rather than
      // inverting it, which is what the equivalent side handle would do.
      const step = gridStep();
      const left = step
        ? snapCoordinateToGrid(Math.min(pending.origin.x, info.point.x), step)
        : Math.min(pending.origin.x, info.point.x);
      const right = step
        ? snapCoordinateToGrid(Math.max(pending.origin.x, info.point.x), step)
        : Math.max(pending.origin.x, info.point.x);
      ctx.editor.updateShape(creatingId, {
        x: left,
        props: {
          ...shape.props,
          sizingMode: 'fixed',
          width: Math.max(MIN_TEXT_WIDTH, right - left),
        },
      });
    },

    onPointerUp(_info: ToolPointerInfo, ctx: ToolContext) {
      const started = pending;
      const drawn = creatingId;
      pending = null;
      creatingId = null;
      if (!started) return;

      if (drawn) {
        edit(ctx, drawn, 0);
        return;
      }
      // A plain click: an auto-sizing text with the caret already in it.
      edit(ctx, create(ctx, started.origin, styledProps(), null), 0);
    },

    // The OS reclaimed the pointer mid-drag. Keep the box drawn so far.
    onCommit(ctx: ToolContext) {
      const drawn = creatingId;
      pending = null;
      creatingId = null;
      if (drawn) edit(ctx, drawn, 0);
    },

    // A second finger landed and a pinch began: drop the in-flight box.
    onCancel(ctx: ToolContext) {
      const drawn = creatingId;
      pending = null;
      creatingId = null;
      if (drawn) ctx.editor.deleteShapes([drawn]);
    },
  };
}
