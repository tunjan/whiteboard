import { Wand2 } from 'lucide-react';
import {
  distance,
  genId,
  pointsBounds,
  type Point,
  type Shape,
} from '@whiteboard/shared';
import { leafDescendants, selectionTargetId } from '../hierarchy';
import { isSelectable } from '../selectable';
import { isEnclosedByPolygon } from '../selection-geometry';
import { spatialIndex, withoutUndo } from '../use-document-store';
import { useEnteredGroupStore } from '../use-entered-group-store';
import { useSelectionStore } from '../use-selection-store';
import type { Editor } from '../editor';
import { createDrawTool } from './draw-tool';
import type { Tool, ToolContext, ToolPointerInfo } from './types';

/**
 * Magic wand: a pen whose strokes can also be a question. The stroke is drawn
 * exactly as the draw tool draws it — same style, same pressure, same live
 * visibility to peers — but when it closes into a loop around existing shapes,
 * the loop is read as "select these" and the ink is discarded instead of kept.
 *
 * Everything about the stroke itself is delegated to a private draw tool, so
 * wand ink and pen ink cannot drift apart.
 */

/** Spacing between recorded lasso vertices, in world units. */
const LASSO_VERTEX_SPACING = 4;
/**
 * How far apart a loop's two ends may be, as a fraction of the loop's
 * bounding-box diagonal. Loose enough for a hand-drawn circle that doesn't
 * quite meet; tight enough that an open arc drawn past a shape is still ink.
 */
const CLOSE_GAP_RATIO = 0.3;
/** Fewest vertices before a gesture can be a loop rather than a dot or a flick. */
const MIN_LASSO_VERTICES = 8;

/**
 * The same editor with every write kept out of undo history.
 *
 * The wand's stroke is provisional until the pointer lifts: a lasso must leave
 * no undo entry at all (Ctrl+Z after selecting should undo whatever came
 * before, not step through a stroke the user never meant to draw), and ink is
 * re-committed as a tracked shape once that's what it turns out to be. It has
 * to be baked into the editor rather than wrapped around the calls because the
 * draw tool's rAF flush writes from outside our handlers.
 */
function undoFreeEditor(editor: Editor, onCreate: (id: string) => void): Editor {
  return {
    ...editor,
    createShape: (shape) => {
      onCreate(shape.id);
      withoutUndo(() => editor.createShape(shape));
    },
    updateShape: (id, patch) => withoutUndo(() => editor.updateShape(id, patch)),
    deleteShapes: (ids) => withoutUndo(() => editor.deleteShapes(ids)),
    transact: (fn) => withoutUndo(() => editor.transact(fn)),
  };
}

/**
 * The gesture as a ring of vertices, or null when it isn't a loop: too short to
 * be one, or its ends too far apart to have circled anything.
 */
function closedLoop(path: Point[]): Point[] | null {
  if (path.length < MIN_LASSO_VERTICES) return null;
  const bounds = pointsBounds(path);
  const diagonal = Math.hypot(
    bounds.maxX - bounds.minX,
    bounds.maxY - bounds.minY,
  );
  if (diagonal === 0) return null;
  const gap = distance(path[0]!, path[path.length - 1]!);
  // `pointInPolygon` closes the ring implicitly, so the gap is all that's left
  // to judge — the vertices themselves need no closing segment appended.
  return gap <= diagonal * CLOSE_GAP_RATIO ? path : null;
}

/** Selectable shapes enclosed by `polygon`, resolved to their selection targets. */
function enclosedIds(polygon: Point[], editor: Editor): string[] {
  const entered = useEnteredGroupStore.getState().enteredGroupId;
  const found = new Set<string>();
  const groups = new Set<string>();

  for (const id of spatialIndex.search(pointsBounds(polygon))) {
    const shape = editor.getShape(id);
    if (!shape || !isSelectable(shape)) continue;
    if (!isEnclosedByPolygon(shape, polygon)) continue;
    const target = selectionTargetId(editor.getShape, shape.id, entered);
    if (editor.getShape(target)?.type === 'group') groups.add(target);
    else found.add(target);
  }

  // A group is one object, so the loop has to have gone round all of it —
  // the same rule the wrapping marquee applies.
  if (groups.size > 0) {
    const shapes = editor.getShapes();
    for (const groupId of groups) {
      const leaves = leafDescendants(shapes, groupId).filter(isSelectable);
      if (
        leaves.length > 0 &&
        leaves.every((leaf) => isEnclosedByPolygon(leaf, polygon))
      ) {
        found.add(groupId);
      }
    }
  }
  return [...found];
}

export function createWandTool(): Tool {
  const ink = createDrawTool();
  // Set for the duration of a stroke; null means no gesture is in flight.
  let inkCtx: ToolContext | null = null;
  // Every shape the inner tool created for this gesture, in order. Usually one,
  // but a long lasso passes the draw tool's point cap and is continued in a
  // second shape — all of them are this one gesture and have to be committed,
  // or discarded, together.
  let strokeIds: string[] = [];
  let path: Point[] = [];

  const reset = (): void => {
    inkCtx = null;
    strokeIds = [];
    path = [];
  };

  const appendVertex = (point: Point): void => {
    const last = path[path.length - 1];
    if (last && distance(last, point) < LASSO_VERTEX_SPACING) return;
    path.push(point);
  };

  /**
   * Hand the finished stroke over to undo history. The drawn shape was written
   * ephemerally, so it is dropped (untracked, leaving no entry) and written
   * again as an ordinary tracked shape — one create, one undo step, exactly
   * like a pen stroke.
   */
  const commitInk = (ctx: ToolContext): void => {
    if (strokeIds.length === 0) return;
    const strokes = strokeIds.map((id) => ctx.editor.getShape(id));
    withoutUndo(() => ctx.editor.deleteShapes(strokeIds));
    ctx.editor.transact(() => {
      for (const stroke of strokes) {
        if (stroke) ctx.editor.createShape({ ...stroke, id: genId() } as Shape);
      }
    });
  };

  /**
   * Drop the ink without a trace. The inner tool only holds the shape it is
   * currently drawing into, so any earlier chunk of the same gesture has to be
   * removed here.
   */
  const discardInk = (inner: ToolContext): void => {
    ink.onCancel?.(inner);
    // `inner.editor` is the untracked one the ink was written through, so this
    // leaves no undo entry either.
    if (strokeIds.length > 0) inner.editor.deleteShapes(strokeIds);
  };

  /**
   * Decide what the finished gesture was. `keepInk` is the inner tool's own way
   * of ending the stroke, run only when the gesture is not a selection.
   */
  const resolve = (ctx: ToolContext, keepInk: (inner: ToolContext) => void): void => {
    const inner = inkCtx;
    if (!inner) return;
    const loop = closedLoop(path);
    const ids = loop ? enclosedIds(loop, ctx.editor) : [];
    if (ids.length > 0) {
      // Discard before the inner tool finalizes: once it has, it no longer
      // holds the shape and could not delete it.
      discardInk(inner);
      reset();
      useSelectionStore.getState().setSelection(ids);
      // Selection is what the user is now holding, so hand them the tool that
      // acts on it — unless tool lock says to stay and circle something else.
      ctx.complete();
      return;
    }
    keepInk(inner);
    commitInk(ctx);
    reset();
  };

  return {
    id: 'wand',
    label: 'Magic wand',
    hotkey: 'w',
    cursor: 'crosshair',
    icon: Wand2,
    // Mirrors the draw tool: the samples reach it through this tool, so what it
    // asks for has to be asked for here too, or wand ink would be coarser than
    // pen ink drawn by the same hand.
    wantsCoalescedSamples: true,
    wantsPredictedSamples: true,

    onPointerDown(info: ToolPointerInfo, ctx: ToolContext) {
      if (info.button !== 0) return;
      reset();
      inkCtx = {
        ...ctx,
        editor: undoFreeEditor(ctx.editor, (id) => {
          strokeIds.push(id);
        }),
      };
      path = [info.point];
      ink.onPointerDown?.(info, inkCtx);
    },

    onPointerMove(info: ToolPointerInfo) {
      if (!inkCtx) return;
      appendVertex(info.point);
      ink.onPointerMove?.(info, inkCtx);
    },

    onPointerUp(info: ToolPointerInfo, ctx: ToolContext) {
      if (!inkCtx) return;
      appendVertex(info.point);
      resolve(ctx, (inner) => ink.onPointerUp?.(info, inner));
    },

    // The OS reclaimed the pointer mid-stroke. The gesture is over either way,
    // so judge it on what was drawn rather than throwing it away.
    onCommit(ctx: ToolContext) {
      resolve(ctx, (inner) => ink.onCommit?.(inner));
    },

    // Switching tools mid-stroke never routes a pointer-up back here. Keep what
    // was drawn, matching the draw tool, and read no selection out of it: the
    // gesture was abandoned rather than completed, and switching tools again
    // from inside a tool switch is not something to do to the caller.
    onExit(ctx: ToolContext) {
      const inner = inkCtx;
      if (!inner) return;
      ink.onExit?.(inner);
      commitInk(ctx);
      reset();
    },

    // A pinch (or interrupt) discards the partial stroke entirely — there is no
    // finished gesture to read a selection out of.
    onCancel() {
      const inner = inkCtx;
      if (inner) discardInk(inner);
      reset();
    },
  };
}
