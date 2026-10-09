import { CompassGlyph } from '@/components/ui/glyphs';
import { type EllipseProps, genId, type Point, type Shape } from '@whiteboard/shared';
import { constructionSnapTargets } from '../construction-snap';
import { getTopIndex } from '../order';
import { shapeRegistry } from '../shapes/shape-registry';
import { SNAP_SCREEN } from '../snap-targets';
import { type PointSnapTarget, snapPoint } from '../snapping';
import { useCameraStore } from '../use-camera-store';
import { useSelectionStore } from '../use-selection-store';
import { nextShapeStyle } from '../use-style-store';
import type { Tool, ToolContext, ToolPointerInfo } from './types';

const CLICK_SCREEN_THRESHOLD = 4;

/**
 * Compass for ruler-and-compass constructions: press on the centre, drag to a
 * point on the circle. Both ends snap to shape points and to crossings of
 * outlines (Alt bypasses). The circle is a plain unfilled ellipse, so it stays
 * editable and is itself a snap target for the next step.
 *
 * Sticky like the pen: a construction is many circles in a row, so it neither
 * selects the result nor drops back to Select.
 */
export function createCompassTool(): Tool {
  let creatingId: string | null = null;
  let center: Point = { x: 0, y: 0 };
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

  function finish(ctx: ToolContext, keep: boolean): void {
    const id = creatingId;
    creatingId = null;
    snapTargets = [];
    useSelectionStore.getState().setSnapGuides([]);
    if (!id) return;
    const shape = ctx.editor.getShape(id);
    const z = useCameraStore.getState().camera.z;
    const tooSmall =
      shape?.type !== 'ellipse' || shape.props.w < CLICK_SCREEN_THRESHOLD / z;
    if (!keep || tooSmall) ctx.editor.deleteShapes([id]);
  }

  return {
    id: 'compass',
    label: 'Compass',
    icon: CompassGlyph,
    cursor: 'crosshair',

    onPointerDown(info, ctx) {
      if (info.button !== 0) return;
      const util = shapeRegistry.get('ellipse');
      if (!util) return;
      snapTargets = constructionSnapTargets(ctx, info.point);
      center = snap(info.point, info);
      const style = nextShapeStyle();
      const id = genId();
      creatingId = id;
      ctx.editor.createShape({
        id,
        type: 'ellipse',
        x: center.x,
        y: center.y,
        rotation: 0,
        opacity: style.opacity,
        index: getTopIndex(ctx.editor.getShapes()),
        props: {
          ...(util.getDefaultProps() as EllipseProps),
          w: 0,
          h: 0,
          color: style.color,
          size: style.size,
          dash: style.dash,
          // A filled circle would hide the construction underneath it.
          fillStyle: 'none',
        },
      } as Shape);
    },

    onPointerMove(info, ctx) {
      if (!creatingId) return;
      const edge = snap(info.point, info);
      const r = Math.hypot(edge.x - center.x, edge.y - center.y);
      ctx.editor.updateShape(creatingId, {
        x: center.x - r,
        y: center.y - r,
        props: { w: 2 * r, h: 2 * r },
      });
    },

    onPointerUp(_info, ctx) {
      finish(ctx, true);
    },

    onCommit(ctx) {
      finish(ctx, true);
    },

    onCancel(ctx) {
      finish(ctx, false);
    },
  };
}
