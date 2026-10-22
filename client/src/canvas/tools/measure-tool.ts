import type { Point } from '@whiteboard/shared';
import { MeasureGlyph } from '@/components/ui/glyphs';
import { constructionSnapTargets } from '../construction-snap';
import { SNAP_SCREEN } from '../snap-targets';
import { type PointSnapTarget, snapPoint } from '../snapping';
import { useMeasureStore } from '../use-measure-store';
import { useSelectionStore } from '../use-selection-store';
import type { Tool, ToolPointerInfo } from './types';

/**
 * Measure: press on one point, drag to another, read the length and angle.
 * Both ends snap like the straightedge and compass (Alt bypasses), so a
 * measurement lands exactly on the corners and crossings it was aimed at. The
 * line stays up after release until the next press or a tool switch; nothing
 * is written to the document.
 */
export function createMeasureTool(): Tool {
  let start: Point | null = null;
  let snapTargets: PointSnapTarget[] = [];

  function snap(point: Point, info: ToolPointerInfo): Point {
    if (info.altKey || !snapTargets.length) {
      useSelectionStore.getState().setSnapGuides([]);
      return point;
    }
    const snapped = snapPoint(point, snapTargets, SNAP_SCREEN / info.zoom);
    useSelectionStore.getState().setSnapGuides(snapped.guides);
    return snapped.point;
  }

  function release(): void {
    start = null;
    snapTargets = [];
    useSelectionStore.getState().setSnapGuides([]);
  }

  return {
    id: 'measure',
    label: 'Measure',
    icon: MeasureGlyph,
    cursor: 'crosshair',

    onPointerDown(info, ctx) {
      if (info.button !== 0) return;
      snapTargets = constructionSnapTargets(ctx, info.point);
      start = snap(info.point, info);
      useMeasureStore.getState().set(start, start);
    },

    onPointerMove(info) {
      if (!start) return;
      useMeasureStore.getState().set(start, snap(info.point, info));
    },

    onPointerUp: release,
    onCommit: release,

    onCancel() {
      release();
      useMeasureStore.getState().clear();
    },

    onExit() {
      release();
      useMeasureStore.getState().clear();
    },
  };
}
