import {
  type DrawPoint,
  type DrawShape,
  type Point,
  distance,
  genId,
  pointsBounds,
  rotatePoint,
} from '@whiteboard/shared';
import type { Editor } from '../editor';
import { getTopIndex } from '../order';
import { shapeRegistry } from '../shapes/shape-registry';
import { useCameraStore } from '../use-camera-store';

const ERASER_SCREEN_RADIUS = 8;

/**
 * Slice a freehand stroke at the eraser point. Points within the eraser radius
 * are removed; each surviving run of consecutive points becomes its own stroke.
 * Returns the runs to keep, or null if the eraser didn't touch this stroke.
 */
function sliceStroke(
  shape: DrawShape,
  world: Point,
  radius: number,
): DrawPoint[][] | null {
  const pts = shape.props.points;
  if (pts.length === 0) return null;

  const b = pointsBounds(pts);
  const center = {
    x: shape.x + (b.minX + b.maxX) / 2,
    y: shape.y + (b.minY + b.maxY) / 2,
  };
  const wp = shape.rotation ? rotatePoint(world, center, -shape.rotation) : world;
  const local = { x: wp.x - shape.x, y: wp.y - shape.y };
  const r = radius + shape.props.size / 2;

  let touched = false;
  const runs: DrawPoint[][] = [];
  let cur: DrawPoint[] = [];
  for (const p of pts) {
    if (distance(p, local) <= r) {
      touched = true;
      if (cur.length) {
        runs.push(cur);
        cur = [];
      }
    } else {
      cur.push(p);
    }
  }
  if (cur.length) runs.push(cur);
  if (!touched) return null;
  // Drop single-point debris.
  return runs.filter((run) => run.length >= 2);
}

/**
 * Destructive erase at a world point: whole-shape delete for non-ink shapes the
 * eraser touches; ink strokes are sliced into surviving pieces.
 */
export function eraseAtPoint(editor: Editor, world: Point): void {
  const radius = ERASER_SCREEN_RADIUS / useCameraStore.getState().camera.z;
  for (const shape of editor.getShapes()) {
    const util = shapeRegistry.getFor(shape);
    if (!util) continue;

    if (shape.type === 'draw') {
      const runs = sliceStroke(shape, world, radius);
      if (runs === null) continue;
      editor.deleteShapes([shape.id]);
      for (const run of runs) {
        editor.createShape({
          ...shape,
          id: genId(),
          index: getTopIndex(editor.getShapes()),
          props: { ...shape.props, points: run },
        });
      }
    } else if (util.hitTest(shape, world, radius)) {
      editor.deleteShapes([shape.id]);
    }
  }
}
