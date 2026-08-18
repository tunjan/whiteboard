import { type Point, type Shape, isContainerType } from '@whiteboard/shared';
import type { Editor } from '../editor';
import { isVisible } from '../selectable';
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
    if (!isVisible(shape)) continue;
    const util = shapeRegistry.getFor(shape);
    if (util?.hitTest(shape, p, margin)) out.add(shape.id);
  }
  return out;
}

/**
 * Shapes the swipe segment a→b could plausibly affect — the broad phase.
 *
 * The spatial index narrows thousands of shapes to the handful whose bounds
 * overlap the swipe envelope (the segment's AABB grown by the collision margin),
 * which is what keeps erasing instant on dense canvases. Containers, locked,
 * hidden and protected shapes are dropped here so neither eraser mode can target
 * them. Callers apply their own narrow-phase test to what comes back.
 */
export function candidatesAlong(
  editor: Editor,
  a: Point,
  b: Point,
  margin: number,
  protectedIds: Set<string>,
): Shape[] {
  const envelope = {
    minX: Math.min(a.x, b.x) - margin,
    minY: Math.min(a.y, b.y) - margin,
    maxX: Math.max(a.x, b.x) + margin,
    maxY: Math.max(a.y, b.y) + margin,
  };
  const out: Shape[] = [];
  for (const id of spatialIndex.search(envelope)) {
    if (protectedIds.has(id)) continue;
    const shape = editor.getShape(id);
    if (!shape || shape.locked || isContainerType(shape.type)) continue;
    // Hidden shapes are invisible — never erase what the user can't see.
    if (!isVisible(shape)) continue;
    out.push(shape);
  }
  return out;
}

/**
 * Ids of shapes the swipe segment a→b should erase whole.
 *
 * The narrow phase over {@link candidatesAlong}: each candidate runs a
 * geometry-specific collision test in its own local frame.
 */
export function eraseAlong(
  editor: Editor,
  a: Point,
  b: Point,
  margin: number,
  protectedIds: Set<string>,
): string[] {
  const out: string[] = [];
  for (const shape of candidatesAlong(editor, a, b, margin, protectedIds)) {
    const util = shapeRegistry.getFor(shape);
    if (util && segmentErasesShape(shape, util, a, b, margin)) out.push(shape.id);
  }
  return out;
}
