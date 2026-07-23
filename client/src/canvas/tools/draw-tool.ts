import { Pencil } from 'lucide-react';
import { genId, type DrawPoint, type DrawProps, type Shape } from '@whiteboard/shared';
import { getTopIndex } from '../order';
import { pencilStabilizationToStreamline } from '../shapes/ink';
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
  let simulatePressure = false;
  // Pending rAF for the live stroke write. Pointer Events can deliver many
  // coalesced samples per frame; without this each sample fired its own Yjs
  // transaction → full document-snapshot rebuild → React commit. Coalescing the
  // writes to one per frame keeps every accumulated point (so the curve is
  // unchanged) while collapsing N pipeline runs per move into one per frame.
  let rafId: number | null = null;

  const cancelPendingFlush = (): void => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };

  const scheduleFlush = (ctx: ToolContext): void => {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      if (id) ctx.editor.updateShape(id, { props: { points: points.slice() } });
    });
  };

  // Commit the accumulated points to the shape and end the stroke. Shared by
  // pointer-up (normal finish) and commit (OS reclaimed the pointer mid-stroke).
  const finalize = (ctx: ToolContext): void => {
    cancelPendingFlush();
    const sid = id;
    id = null;
    if (!sid) return;
    // Final synchronous write, covering the flush this cancelled. The points are
    // committed exactly as drawn: the ink engine streamlines with an EMA over
    // the point sequence, so thinning samples here would change its smoothing
    // lag and visibly reshape the stroke when the pointer lifts.
    ctx.editor.updateShape(sid, { props: { points: points.slice() } });
    points = [];
  };

  // Minimum spacing between recorded samples, in world units. See `appendPoint`.
  const MIN_SAMPLE_DISTANCE = 1;

  const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

  const pressureFor = (info: ToolPointerInfo): number => {
    // Stylus pressure is conditioned once at ingestion and then persisted.
    // Mouse/touch samples carry the neutral default; the vector engine derives
    // their pressure from inter-sample distance when simulation is enabled.
    return info.pointerType === 'pen'
      ? clamp01(info.pressure * 1.25)
      : 0.5;
  };

  const snapToAngle = (point: DrawPoint): DrawPoint => {
    const start = points[0];
    if (!start) return point;
    const dx = point.x - start.x;
    const dy = point.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) return point;
    const increment = Math.PI / 12;
    const angle = Math.atan2(dy, dx);
    const snappedAngle = Math.round(angle / increment) * increment;
    return {
      ...point,
      x: start.x + Math.cos(snappedAngle) * length,
      y: start.y + Math.sin(snappedAngle) * length,
    };
  };

  const appendPoint = (info: ToolPointerInfo): boolean => {
    let local: DrawPoint = {
      x: info.point.x - origin.x,
      y: info.point.y - origin.y,
      pressure: pressureFor(info),
    };
    if (info.shiftKey) {
      local = snapToAngle(local);
      const start = points[0];
      const currentEnd = points[1];
      if (
        start &&
        currentEnd &&
        currentEnd.x === local.x &&
        currentEnd.y === local.y &&
        currentEnd.pressure === local.pressure
      ) {
        return false;
      }
      points = start ? [start, local] : [local];
      return true;
    }

    const last = points[points.length - 1];
    if (last) {
      // Gate on world distance, not screen distance. `streamline` smooths via an
      // EMA over the point *sequence*, so how densely a stroke is sampled decides
      // how much it gets smoothed — and a zoom-scaled gate made that a function
      // of the camera. The same gesture came out ~36% of a brush width apart
      // drawn at zoom 4 vs zoom 1, and zoomed out the gate was wide enough
      // (20 world units at zoom 0.05) to throw away real pointer samples.
      // One world unit is what a zoom-1 stroke already captured, so feel there is
      // unchanged and every other zoom now matches it. Pressure is still merged
      // so slow stationary strokes retain their thickness response.
      if (Math.hypot(last.x - local.x, last.y - local.y) < MIN_SAMPLE_DISTANCE) {
        if (last.pressure === local.pressure) return false;
        // Replace (don't mutate): the previous object was already handed to Yjs
        // by an earlier flush's `points.slice()`, so mutating it in place would
        // desync the stored value from the document.
        points[points.length - 1] = { ...last, pressure: local.pressure };
        return true;
      }
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
    // `streamline` is an EMA over the point sequence, so every dropped sample
    // changes the smoothing lag and reshapes the stroke. The rAF flush below
    // keeps the extra samples from costing extra document writes.
    wantsCoalescedSamples: true,

    onPointerDown(info: ToolPointerInfo, ctx: ToolContext) {
      if (info.button !== 0) return;
      const util = shapeRegistry.get('draw');
      if (!util) return;
      origin = info.point;
      const pencil = useCanvasUiStore.getState();
      // Real pens carry hardware pressure; only mouse/touch fall back to the
      // user's velocity-based simulation preference.
      simulatePressure =
        info.pointerType !== 'pen' && pencil.pencilSimulatePressure;
      points = [{ x: 0, y: 0, pressure: pressureFor(info) }];
      const streamline = pencilStabilizationToStreamline(
        pencil.pencilStabilization,
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
          dash: useStyleStore.getState().dash,
          simulatePressure,
          thinning: pencil.pencilThinning,
          smoothing: pencil.pencilSmoothing,
          streamline,
          startTaper: pencil.pencilStartTaper,
          endTaper: pencil.pencilEndTaper,
        },
      } as Shape;
      ctx.editor.createShape(shape);
    },

    onPointerMove(info: ToolPointerInfo, ctx: ToolContext) {
      if (!id) return;
      if (appendPoint(info)) scheduleFlush(ctx);
    },

    onPointerUp(info: ToolPointerInfo, ctx: ToolContext) {
      appendPoint(info);
      finalize(ctx);
      // Stay in the draw tool; intentionally no selection of the new stroke.
    },

    // The OS reclaimed the pen/mouse mid-stroke (spurious pointercancel /
    // lostpointercapture). Keep the ink drawn so far rather than discarding it.
    onCommit(ctx: ToolContext) {
      finalize(ctx);
    },

    // Switching tools mid-stroke (a hotkey while the pointer is still down)
    // never routes a pointer-up back here, so without this the stroke kept
    // whatever the last rAF flush wrote and left that flush pending against an
    // orphaned shape. Commit it, matching onCommit's "keep what was drawn".
    onExit(ctx: ToolContext) {
      finalize(ctx);
    },

    // A pinch (or tool switch) mid-stroke discards the partial stroke entirely.
    onCancel(ctx: ToolContext) {
      cancelPendingFlush();
      const sid = id;
      id = null;
      points = [];
      if (sid) ctx.editor.deleteShapes([sid]);
    },
  };
}
