import { type Point, isContainerType } from '@whiteboard/shared';
import type { Editor } from '../editor';
import { shapeRegistry } from '../shapes/shape-registry';
import { spatialIndex } from '../use-document-store';
import { segmentErasesShape } from './erase-geometry';

/**
 * Shapes under the start point that must survive the whole stroke: containers
 * (frames/groups) and text boxes. When you begin a swipe on top of one of these
 * "backgrounds", dragging across it erases the drawings on it — not the
 * background itself. Captured once on pointer down (see {@link protectedAt}).
 */
export function protectedAt(editor: Editor, p: Point, margin: number): Set<string> {
  const out = new Set<string>();
  for (const shape of editor.getShapes()) {
    if (!isContainerType(shape.type) && shape.type !== 'text') continue;
    const util = shapeRegistry.getFor(shape);
    if (util?.hitTest(shape, p, margin)) out.add(shape.id);
  }
  return out;
}

/**
 * Ids of shapes the swipe segment a→b should erase.
 *
 * Two-stage filtering keeps this instant on dense canvases: the spatial index
 * narrows thousands of shapes to the handful whose bounds overlap the swipe
 * envelope (the segment's AABB grown by the collision margin), then each
 * candidate runs a geometry-specific collision test in its own local frame.
 * Containers and protected backgrounds are never targeted.
 */
export function eraseAlong(
  editor: Editor,
  a: Point,
  b: Point,
  margin: number,
  protectedIds: Set<string>,
): string[] {
  const envelope = {
    minX: Math.min(a.x, b.x) - margin,
    minY: Math.min(a.y, b.y) - margin,
    maxX: Math.max(a.x, b.x) + margin,
    maxY: Math.max(a.y, b.y) + margin,
  };
  const out: string[] = [];
  for (const id of spatialIndex.search(envelope)) {
    if (protectedIds.has(id)) continue;
    const shape = editor.getShape(id);
    if (!shape || shape.locked || isContainerType(shape.type)) continue;
    const util = shapeRegistry.getFor(shape);
    if (util && segmentErasesShape(shape, util, a, b, margin)) out.push(id);
  }
  return out;
}
