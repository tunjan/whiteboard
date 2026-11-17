import { FrameGlyph } from '@/components/ui/glyphs';
import {
  type Bounds,
  genId,
  type FrameProps,
  type Shape,
} from '@whiteboard/shared';
import { getBottomIndex } from '../order';
import { captureEnclosedShapes, topFrameAtPoint } from '../frame-operations';
import { shapeRegistry } from '../shapes/shape-registry';
import { useSelectionStore } from '../use-selection-store';
import { nextShapeStyle } from '../use-style-store';
import { dragBoxSnapTargets, snappedBoxFromDrag } from './drag-box';
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
  let snapTargets: Bounds[] = [];

  // Finish the in-flight frame, keeping it. Shared by pointer-up (normal
  // finish) and commit (OS reclaimed the pointer mid-create — keep what was
  // drawn rather than discarding via onCancel).
  function finalize(ctx: ToolContext): void {
    const id = creatingId;
    creatingId = null;
    snapTargets = [];
    useSelectionStore.getState().setSnapGuides([]);
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

    // Capture every unlocked sibling root completely enclosed by the final
    // viewport, including groups and existing frames (nested frames).
    captureEnclosedShapes(ctx.editor, id);

    useSelectionStore.getState().setSelection([id]);
    ctx.complete();
  }

  return {
    id: 'frame',
    label: 'Frame',
    hotkey: 'f',
    cursor: 'crosshair',
    icon: FrameGlyph,

    onPointerDown(info: ToolPointerInfo, ctx: ToolContext) {
      if (info.button !== 0) return;
      const util = shapeRegistry.get('frame');
      if (!util) return;
      start = info.point;
      const id = genId();
      creatingId = id;
      const shapes = ctx.editor.getShapes();
      const parentId = topFrameAtPoint(shapes, info.point)?.id ?? null;
      const count = shapes.filter((s) => s.type === 'frame').length;
      const props: FrameProps = {
        ...(util.getDefaultProps() as FrameProps),
        w: 0,
        h: 0,
        name: `Frame ${count + 1}`,
        color: nextShapeStyle().color,
      };
      const shape = {
        id,
        type: 'frame',
        parentId,
        x: info.point.x,
        y: info.point.y,
        rotation: 0,
        opacity: 1,
        // The background begins below its siblings; captured shapes keep their
        // indices and therefore remain above it inside the new frame.
        index: getBottomIndex(
          shapes.filter(
            (candidate) => (candidate.parentId ?? null) === parentId,
          ),
        ),
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
      finalize(ctx);
    },

    // The OS reclaimed the pointer mid-create (spurious pointercancel /
    // lostpointercapture). Keep the frame drawn so far rather than discarding it.
    onCommit(ctx: ToolContext) {
      finalize(ctx);
    },

    // Pinch-to-zoom mid-create: drop the in-flight frame, stay in the tool.
    onCancel(ctx: ToolContext) {
      const id = creatingId;
      creatingId = null;
      snapTargets = [];
      useSelectionStore.getState().setSnapGuides([]);
      if (id) ctx.editor.deleteShapes([id]);
    },
  };
}
