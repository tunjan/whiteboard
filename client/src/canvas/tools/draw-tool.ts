import { Pencil } from 'lucide-react';
import { genId, type DrawPoint, type DrawProps, type Shape } from '@whiteboard/shared';
import { getTopIndex } from '../order';
import { pencilStabilizationToStreamline } from '../shapes/ink';
import { shapeRegistry } from '../shapes/shape-registry';
import { simplifyRDP } from '../shapes/simplify';
import { DEFAULT_INK_SIZE } from '../shapes/style';
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
  // Brush width of the stroke in progress, captured at pointer-down so the
  // commit-time simplification tolerance scales with it.
  let strokeSize = DEFAULT_INK_SIZE;
  let previousSample: { x: number; y: number; timestamp: number } | null = null;
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
    // Final synchronous write. Raw pointer input carries far more samples than
    // the curve needs, and every one of them is paid for again on each later
    // render (`getInkPathData` runs perfect-freehand over the whole array), on
    // each hit test, and in the Yjs payload for every client — forever. Collapse
    // them once, here on commit only: the live path above still writes every
    // sample, so mid-stroke feel and what peers see while drawing are untouched.
    ctx.editor.updateShape(sid, {
      props: { points: simplifyRDP(points, strokeSize * SIMPLIFY_EPSILON) },
    });
    points = [];
    previousSample = null;
  };

  // Commit-time simplification tolerance, as a fraction of the brush width.
  // Deliberately far below the width so removed points are well inside the ink
  // and the committed curve is visually identical to what was drawn.
  const SIMPLIFY_EPSILON = 0.06;

  // Calibrated in screen pixels/ms so a stroke has the same pressure response
  // at every camera zoom level (0.08 = slow, 1.25 = fast).
  const PRESSURE_MIN_SPEED = 0.08;
  const PRESSURE_MAX_SPEED = 1.25;

  const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

  const pressureFor = (info: ToolPointerInfo): number => {
    const previous = previousSample;
    previousSample = {
      x: info.screenPoint.x,
      y: info.screenPoint.y,
      timestamp: info.timestamp,
    };
    if (!simulatePressure) return clamp01(info.pressure);
    if (!previous) return 0.5;

    const elapsed = Math.max(1, info.timestamp - previous.timestamp);
    const speed =
      Math.hypot(
        info.screenPoint.x - previous.x,
        info.screenPoint.y - previous.y,
      ) / elapsed;
    return 1 - clamp01((speed - PRESSURE_MIN_SPEED) / (PRESSURE_MAX_SPEED - PRESSURE_MIN_SPEED));
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
      // Keep input density at roughly one sample per screen pixel, independent
      // of zoom. Pressure is still merged so slow stationary strokes retain
      // their thickness response.
      const minDistance = 1 / Math.max(info.zoom, 0.05);
      if (Math.hypot(last.x - local.x, last.y - local.y) < minDistance) {
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
      previousSample = null;
      points = [{ x: 0, y: 0, pressure: pressureFor(info) }];
      const streamline = pencilStabilizationToStreamline(
        pencil.pencilStabilization,
      );
      const sid = genId();
      id = sid;
      strokeSize = useStyleStore.getState().size;
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
          // Pressure has been conditioned at input time, so the renderer must
          // not simulate it again.
          simulatePressure: false,
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

    // A pinch (or tool switch) mid-stroke discards the partial stroke entirely.
    onCancel(ctx: ToolContext) {
      cancelPendingFlush();
      const sid = id;
      id = null;
      points = [];
      previousSample = null;
      if (sid) ctx.editor.deleteShapes([sid]);
    },
  };
}
