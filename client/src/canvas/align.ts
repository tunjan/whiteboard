import type { Bounds, Shape } from '@whiteboard/shared';
import type { Editor } from './editor';
import { shapeRegistry } from './shapes/shape-registry';

export type AlignEdge = 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom';
export type DistributeAxis = 'horizontal' | 'vertical';

interface Item {
  shape: Shape;
  bounds: Bounds;
}

/** Collect movable (unlocked) selected shapes with their world bounds. */
function items(editor: Editor, ids: string[]): Item[] {
  const out: Item[] = [];
  for (const id of ids) {
    const shape = editor.getShape(id);
    if (!shape || shape.locked) continue;
    const util = shapeRegistry.getFor(shape);
    if (util) out.push({ shape, bounds: util.getBounds(shape) });
  }
  return out;
}

function move(editor: Editor, shape: Shape, dx: number, dy: number): void {
  editor.updateShape(shape.id, { x: shape.x + dx, y: shape.y + dy });
}

/** Align selected shapes to a shared edge or center (needs 2+). */
export function alignShapes(editor: Editor, ids: string[], edge: AlignEdge): void {
  const list = items(editor, ids);
  if (list.length < 2) return;
  const union = list.reduce<Bounds>(
    (acc, it) => ({
      minX: Math.min(acc.minX, it.bounds.minX),
      minY: Math.min(acc.minY, it.bounds.minY),
      maxX: Math.max(acc.maxX, it.bounds.maxX),
      maxY: Math.max(acc.maxY, it.bounds.maxY),
    }),
    { ...list[0]!.bounds },
  );
  editor.transact(() => {
    for (const { shape, bounds } of list) {
      switch (edge) {
        case 'left':
          move(editor, shape, union.minX - bounds.minX, 0);
          break;
        case 'right':
          move(editor, shape, union.maxX - bounds.maxX, 0);
          break;
        case 'centerX':
          move(editor, shape, (union.minX + union.maxX) / 2 - (bounds.minX + bounds.maxX) / 2, 0);
          break;
        case 'top':
          move(editor, shape, 0, union.minY - bounds.minY);
          break;
        case 'bottom':
          move(editor, shape, 0, union.maxY - bounds.maxY);
          break;
        case 'centerY':
          move(editor, shape, 0, (union.minY + union.maxY) / 2 - (bounds.minY + bounds.maxY) / 2);
          break;
      }
    }
  });
}

/** Even spacing between selected shapes along an axis (needs 3+). */
export function distributeShapes(
  editor: Editor,
  ids: string[],
  axis: DistributeAxis,
): void {
  const list = items(editor, ids);
  if (list.length < 3) return;
  const horizontal = axis === 'horizontal';
  const lo = (b: Bounds) => (horizontal ? b.minX : b.minY);
  const hi = (b: Bounds) => (horizontal ? b.maxX : b.maxY);
  const sorted = [...list].sort((a, b) => lo(a.bounds) - lo(b.bounds));
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const totalSize = sorted.reduce((sum, it) => sum + (hi(it.bounds) - lo(it.bounds)), 0);
  const span = hi(last.bounds) - lo(first.bounds);
  const gap = (span - totalSize) / (sorted.length - 1);
  let cursor = lo(first.bounds);
  editor.transact(() => {
    for (const it of sorted) {
      const size = hi(it.bounds) - lo(it.bounds);
      const delta = cursor - lo(it.bounds);
      move(editor, it.shape, horizontal ? delta : 0, horizontal ? 0 : delta);
      cursor += size + gap;
    }
  });
}
