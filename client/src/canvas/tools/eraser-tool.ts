import { Eraser } from 'lucide-react';
import { genId, type Point, type Shape } from '@whiteboard/shared';
import { pruneDegenerateGroups } from '../commands';
import { generateKeyBetween } from '../order';
import { shapeRegistry } from '../shapes/shape-registry';
import { useCameraStore } from '../use-camera-store';
import { useCanvasUiStore, type EraserMode } from '../use-canvas-ui-store';
import { useEraserCutStore } from '../use-eraser-cut-store';
import { useEraserStore } from '../use-eraser-store';
import { candidatesAlong, eraseAlong, protectedAt } from './erase';
import { segmentErasesShape } from './erase-geometry';
import { cutRuns, cuttablePoints, fragmentShape, type PointRun } from './precision-erase';
import type { Tool, ToolContext, ToolPointerInfo } from './types';

/** Collision radius in screen pixels; scaled to world units by the zoom level. */
export const ERASER_SCREEN_RADIUS = 8;

/** Collision radius in world units at the current zoom. */
function eraserMargin(): number {
  return ERASER_SCREEN_RADIUS / useCameraStore.getState().camera.z;
}

/**
 * Two-phase swipe eraser with two modes.
 *
 * In **object** mode the shapes the swipe crosses are added to a pending queue
 * and rendered faded (the highlight phase) rather than deleted. In **precision**
 * mode pen strokes and lines are instead *cut* where the swipe crosses them, and
 * the surviving pieces are previewed in place of the original; everything with no
 * meaningful half — boxes, text, arrows, polygons — still joins the delete queue.
 *
 * Either way nothing is written until release, when the whole stroke's worth of
 * deletes and cuts is applied in one batched command, so a single undo restores
 * it all. Escaping or switching tools mid-stroke discards the lot and restores
 * every shape. The tool stays active after a stroke for repeated erasing.
 */
export function createEraserTool(): Tool {
  let erasing = false;
  let last: Point | null = null;
  /** Mode captured at pointer-down, so a mid-stroke change can't split a swipe. */
  let mode: EraserMode = 'object';
  /** Backgrounds (containers/text) under the start point, spared all stroke. */
  let protectedIds = new Set<string>();
  /** Accumulated queue of shape ids to delete on release. */
  const queue = new Set<string>();
  /** Surviving runs per cut shape (precision mode). Empty array = fully erased. */
  const cuts = new Map<string, PointRun[]>();

  /** End the stroke, clearing transient state and the preview. */
  function reset() {
    erasing = false;
    last = null;
    protectedIds = new Set();
    queue.clear();
    cuts.clear();
    useEraserStore.getState().clear();
    useEraserCutStore.getState().clear();
  }

  /** Rebuild the in-place preview from the accumulated runs. */
  function publishCuts(editor: ToolContext['editor']) {
    const out: Record<string, Shape[]> = {};
    for (const [id, runs] of cuts) {
      const shape = editor.getShape(id);
      if (!shape) continue;
      out[id] = runs.map((run, i) => fragmentShape(shape, run, `${id}#${i}`));
    }
    useEraserCutStore.getState().set(out);
  }

  function extend(editor: ToolContext['editor'], from: Point, to: Point) {
    const margin = eraserMargin();
    if (mode === 'object') {
      for (const id of eraseAlong(editor, from, to, margin, protectedIds)) {
        queue.add(id);
      }
      useEraserStore.getState().set([...queue]);
      return;
    }

    let cutChanged = false;
    for (const shape of candidatesAlong(editor, from, to, margin, protectedIds)) {
      const base = cuttablePoints(shape);
      if (!base) {
        // Not a polyline: precision mode falls back to the whole-shape rule.
        const util = shapeRegistry.getFor(shape);
        if (util && segmentErasesShape(shape, util, from, to, margin)) {
          queue.add(shape.id);
        }
        continue;
      }
      // An untouched shape is cut against a throwaway seed, so `cutRuns`
      // returning it unchanged also means "don't start tracking this one".
      const current = cuts.get(shape.id) ?? [base];
      const next = cutRuns(shape, current, from, to, margin);
      if (next === current) continue;
      cuts.set(shape.id, next);
      cutChanged = true;
    }
    useEraserStore.getState().set([...queue]);
    if (cutChanged) publishCuts(editor);
  }

  /**
   * Write the stroke's deletes and cuts. One transaction is what makes the whole
   * swipe a single undo step; the canvas breaks undo capture at both gesture
   * boundaries so it cannot merge with anything either side.
   */
  function commit(ctx: ToolContext) {
    if (!erasing) return;
    const deletions = [...queue];
    const entries = [...cuts];
    // Groups the erased shapes belonged to, checked once the writes land: the
    // prune has to read the post-delete hierarchy, so it cannot run inside the
    // transaction below.
    const orphanedParents = new Set<string>();
    if (deletions.length || entries.length) {
      ctx.editor.transact(() => {
        // Sorted by index, so the shape after the original bounds the range the
        // extra fragments are inserted into — they stay stacked where the ink was.
        const sorted = ctx.editor.getShapes();
        for (const [id, runs] of entries) {
          const shape = ctx.editor.getShape(id);
          if (!shape) continue;
          if (runs.length === 0) {
            deletions.push(id);
            continue;
          }
          // The first fragment keeps the original id, so its parent, z-index and
          // anything referring to it survive the cut.
          const first = fragmentShape(shape, runs[0]!, id);
          ctx.editor.updateShape(id, {
            x: first.x,
            y: first.y,
            // The patch's prop bag is intentionally loose; this one came from
            // the same shape, so it is the right shape's props by construction.
            props: first.props as Record<string, unknown>,
          });
          if (runs.length === 1) continue;
          let below = shape.index;
          const above = indexAfter(sorted, shape);
          for (let i = 1; i < runs.length; i++) {
            const index = generateKeyBetween(below, above);
            ctx.editor.createShape({
              ...fragmentShape(shape, runs[i]!, genId()),
              index,
            });
            below = index;
          }
        }
        if (deletions.length) {
          for (const id of deletions) {
            const parentId = ctx.editor.getShape(id)?.parentId;
            if (parentId) orphanedParents.add(parentId);
          }
          ctx.editor.deleteShapes(deletions);
        }
      });
    }
    if (orphanedParents.size) {
      pruneDegenerateGroups(ctx.editor, orphanedParents);
    }
    reset();
  }

  return {
    id: 'eraser',
    label: 'Eraser',
    hotkey: 'e',
    cursor: 'crosshair',
    icon: Eraser,
    // Each sample extends the swept segment, so finer samples track a fast
    // curved swipe more accurately. Erasing is destructive; keep the fidelity.
    // Costs no document write until pointer-up, so this is not a hot path.
    wantsCoalescedSamples: true,

    onPointerDown(info: ToolPointerInfo, ctx: ToolContext) {
      if (info.button !== 0) return;
      erasing = true;
      last = info.point;
      mode = useCanvasUiStore.getState().eraserMode;
      protectedIds = protectedAt(ctx.editor, info.point, eraserMargin());
      queue.clear();
      cuts.clear();
      // A click with no drag still erases what's under the cursor.
      extend(ctx.editor, info.point, info.point);
    },

    onPointerMove(info: ToolPointerInfo, ctx: ToolContext) {
      if (!erasing) return;
      const from = last ?? info.point;
      extend(ctx.editor, from, info.point);
      last = info.point;
    },

    onPointerUp(_info: ToolPointerInfo, ctx: ToolContext) {
      commit(ctx);
    },

    // A pen/mouse pointer can be reclaimed without a pointerup. The canvas
    // treats that as a committed gesture, so the pending erase must persist.
    onCommit(ctx: ToolContext) {
      commit(ctx);
    },

    // Pressing the eraser's own hotkey while it is already active switches
    // modes, which is how precision erasing is reached from the keyboard. The
    // canvas only offers a tool unmodified keys, so there is nothing to exclude.
    onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'e' && e.key !== 'E') return false;
      const ui = useCanvasUiStore.getState();
      ui.setEraserMode(ui.eraserMode === 'object' ? 'precision' : 'object');
      return true;
    },

    // Escape / tool switch / pinch mid-stroke cancels: the preview reverts and
    // nothing is written.
    onExit() {
      reset();
    },
    onCancel() {
      reset();
    },
  };
}

/** Index of the first shape stacked above `shape`, or null when it is on top. */
function indexAfter(sorted: readonly Shape[], shape: Shape): string | null {
  for (const other of sorted) {
    if (other.index > shape.index) return other.index;
  }
  return null;
}
