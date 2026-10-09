import type { ComponentType } from 'react';
import { genId, type ArrowProps, type LineProps, type Shape } from '@whiteboard/shared';
import { constructionSnapTargets } from '../construction-snap';
import { getTopIndex } from '../order';
import {
  bindingForPoint,
  findBindableShapeAt,
  orthogonalRoute,
} from '../shapes/connector-routing';
import { shapeRegistry } from '../shapes/shape-registry';
import { shapeSnapGeometry } from '../snap-geometry';
import { SNAP_SCREEN, snapRegion, snapTargetShapes } from '../snap-targets';
import { type PointSnapTarget, snapPoint } from '../snapping';
import { useCameraStore } from '../use-camera-store';
import { useSelectionStore } from '../use-selection-store';
import { nextShapeStyle, useStyleStore } from '../use-style-store';
import type { Tool, ToolContext, ToolPointerInfo } from './types';

const CLICK_SCREEN_THRESHOLD = 4;

interface LineToolOptions {
  id: string;
  type: 'line' | 'arrow';
  label: string;
  hotkey?: string;
  icon: ComponentType<{ className?: string }>;
  /**
   * Straightedge mode: endpoints also snap to where outlines cross, whatever
   * the snapping preference, and the tool stays active without selecting what
   * it drew, like the compass.
   */
  construction?: boolean;
}

/** Drag-to-create tool shared by line and arrow (two-point polylines). */
export function createLineTool(opts: LineToolOptions): Tool {
  let creatingId: string | null = null;
  let startTargetId: string | null = null;
  let start = { x: 0, y: 0 };
  /**
   * Snap candidates for this create gesture, collected at pointer-down so the
   * shape being drawn can never become its own target and the set stays stable
   * for the whole drag.
   */
  let snapTargets: PointSnapTarget[] = [];

  /**
   * Snap an endpoint to nearby shape geometry, publishing the guides. Alt
   * bypasses snapping; Shift already constrains the drag to an axis, so it
   * takes precedence rather than fighting the snap.
   */
  function snapEndpoint(
    point: { x: number; y: number },
    info: ToolPointerInfo,
  ): { x: number; y: number } {
    if (info.altKey || info.shiftKey || !snapTargets.length) {
      useSelectionStore.getState().setSnapGuides([]);
      return point;
    }
    const snapped = snapPoint(point, snapTargets, SNAP_SCREEN / info.zoom);
    useSelectionStore.getState().setSnapGuides(snapped.guides);
    return snapped.point;
  }

  // Finish the in-flight line/arrow. Shared by pointer-up (normal finish) and
  // commit (OS reclaimed the pointer mid-create — keep what was drawn). Length is
  // read from the shape's own endpoints so it works without a pointer position.
  function finalize(ctx: ToolContext): void {
    const id = creatingId;
    creatingId = null;
    startTargetId = null;
    snapTargets = [];
    useSelectionStore.getState().setSnapGuides([]);
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
    else if (opts.construction) return;
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
      snapTargets = opts.construction
        ? constructionSnapTargets(ctx, info.point)
        : snapTargetShapes(
            ctx.editor,
            new Set(),
            // The line is created at the page root, so that is the snap scope.
            null,
            snapRegion(ctx, {
              minX: info.point.x,
              minY: info.point.y,
              maxX: info.point.x,
              maxY: info.point.y,
            }),
          ).flatMap((target) => {
            const geometry = shapeSnapGeometry(target);
            return geometry ? [{ ...geometry, shapeId: target.id }] : [];
          });
      start = snapEndpoint(info.point, info);
      const id = genId();
      creatingId = id;
      const base = util.getDefaultProps() as LineProps | ArrowProps;
      const style = nextShapeStyle();
      const connector = useStyleStore.getState();
      startTargetId =
        opts.type === 'arrow'
          ? findBindableShapeAt(
              ctx.editor.getShapes(),
              start,
              10 / info.zoom,
              id,
            )?.id ?? null
          : null;
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
            ? {
                arrowStart: connector.arrowStart,
                arrowEnd: connector.arrowEnd,
                topology: connector.arrowTopology ?? 'straight',
                bindings: {},
                label: '',
              }
            : {
                spline: opts.construction
                  ? 'linear'
                  : (connector.lineSpline ?? 'linear'),
                label: '',
              }),
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
      const shape = ctx.editor.getShape(creatingId);
      if (!shape || (shape.type !== 'line' && shape.type !== 'arrow')) return;
      const end = snapEndpoint({ x: start.x + dx, y: start.y + dy }, info);
      if (shape.type === 'line') {
        ctx.editor.updateShape(creatingId, {
          props: {
            points: [
              { x: 0, y: 0 },
              { x: end.x - shape.x, y: end.y - shape.y },
            ],
          },
        });
        return;
      }

      const rawEnd = end;
      const startTarget = startTargetId
        ? ctx.editor.getShape(startTargetId)
        : undefined;
      const endTarget = findBindableShapeAt(
        ctx.editor.getShapes(),
        rawEnd,
        10 / info.zoom,
        creatingId,
      );
      let startPoint = start;
      let endPoint = rawEnd;
      let startBinding = null;
      let endBinding = null;
      if (startTarget) {
        const resolved = bindingForPoint(startTarget, startPoint, endPoint);
        if (resolved) {
          startPoint = resolved.point;
          startBinding = resolved.binding;
        }
      }
      if (endTarget) {
        const resolved = bindingForPoint(endTarget, endPoint, startPoint);
        if (resolved) {
          endPoint = resolved.point;
          endBinding = resolved.binding;
        }
      }
      const first = { x: startPoint.x - shape.x, y: startPoint.y - shape.y };
      const last = { x: endPoint.x - shape.x, y: endPoint.y - shape.y };
      const topology = shape.props.topology ?? 'straight';
      const length = Math.hypot(last.x - first.x, last.y - first.y);
      ctx.editor.updateShape(creatingId, {
        props: {
          points:
            topology === 'elbow' ? orthogonalRoute(first, last) : [first, last],
          bend:
            topology === 'arc'
              ? Math.max(18, Math.min(80, length * 0.2))
              : 0,
          bindings: { start: startBinding, end: endBinding },
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
      startTargetId = null;
      snapTargets = [];
      useSelectionStore.getState().setSnapGuides([]);
      if (id) ctx.editor.deleteShapes([id]);
    },
  };
}
