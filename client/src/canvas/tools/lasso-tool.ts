import { Lasso } from 'lucide-react';
import {
  type Point,
  boundsCenter,
  pointInPolygon,
  pointsBounds,
} from '@whiteboard/shared';
import { isSelectable } from '../selectable';
import { shapeRegistry } from '../shapes/shape-registry';
import { spatialIndex } from '../use-document-store';
import { useSelectionStore } from '../use-selection-store';
import type { Tool, ToolContext, ToolPointerInfo } from './types';

/** Minimum points before we start hit-testing (avoids a degenerate polygon). */
const MIN_POINTS = 3;

/**
 * Freehand lasso selection: draw a loop and every shape whose center falls
 * inside the polygon is selected. Skips locked and hidden shapes. Reverts to
 * the select tool afterward so the loop can be manipulated immediately.
 */
export function createLassoTool(): Tool {
  let points: Point[] = [];
  let active = false;
  let base: string[] = [];

  function selectInside(ctx: ToolContext) {
    if (points.length < MIN_POINTS) return;
    const bbox = pointsBounds(points);
    const candidates = spatialIndex.search(bbox);
    const found: string[] = [];
    for (const id of candidates) {
      const shape = ctx.editor.getShape(id);
      if (!shape || !isSelectable(shape)) continue;
      const util = shapeRegistry.getFor(shape);
      if (!util) continue;
      if (pointInPolygon(boundsCenter(util.getBounds(shape)), points)) {
        found.push(id);
      }
    }
    useSelectionStore
      .getState()
      .setSelection([...new Set([...base, ...found])]);
  }

  return {
    id: 'lasso',
    label: 'Lasso',
    hotkey: 's',
    cursor: 'crosshair',
    icon: Lasso,

    onPointerDown(info: ToolPointerInfo) {
      if (info.button !== 0) return;
      active = true;
      points = [info.point];
      const sel = useSelectionStore.getState();
      base = info.shiftKey ? sel.selectedIds : [];
      if (!info.shiftKey) sel.clear();
      sel.setLasso(points);
    },

    onPointerMove(info: ToolPointerInfo, ctx: ToolContext) {
      if (!active) return;
      points.push(info.point);
      useSelectionStore.getState().setLasso([...points]);
      selectInside(ctx);
    },

    onPointerUp(_info: ToolPointerInfo, ctx: ToolContext) {
      if (!active) return;
      active = false;
      selectInside(ctx);
      useSelectionStore.getState().setLasso(null);
      points = [];
      // Hand off to select so the new selection is immediately editable.
      if (useSelectionStore.getState().selectedIds.length > 0) {
        ctx.setTool('select');
      }
    },
  };
}
