import { generateNKeysBetween } from 'fractional-indexing';
import type { Editor } from './editor';

/**
 * Reassign fractional indices to realize `newOrderIds` (ascending z-order),
 * renumbering only the shapes whose position actually changed. Untouched shapes
 * keep their existing keys, so concurrent reordering of disjoint shapes stays
 * conflict-free — the whole point of fractional indexing (see order.ts). The
 * renumbered shapes are written in one transaction (one undo step, one snapshot
 * rebuild) instead of a separate transaction per shape.
 */
function applyOrder(editor: Editor, newOrderIds: string[]): void {
  const shapes = editor.getShapes(); // z-sorted ascending
  const keyById = new Map(shapes.map((s) => [s.id, s.index]));
  const oldOrderIds = shapes.map((s) => s.id);
  const n = newOrderIds.length;

  const updates: { id: string; index: string }[] = [];
  let i = 0;
  while (i < n) {
    if (newOrderIds[i] === oldOrderIds[i]) {
      i++;
      continue;
    }
    // A contiguous run of shapes that changed position: rekey just this run,
    // fitting it between its nearest unchanged neighbours' existing keys. Those
    // anchors keep their original order, so the generated keys stay valid.
    let j = i;
    while (j < n && newOrderIds[j] !== oldOrderIds[j]) j++;
    const left = i > 0 ? keyById.get(newOrderIds[i - 1]!)! : null;
    const right = j < n ? keyById.get(newOrderIds[j]!)! : null;
    const keys = generateNKeysBetween(left, right, j - i);
    for (let k = i; k < j; k++) {
      updates.push({ id: newOrderIds[k]!, index: keys[k - i]! });
    }
    i = j;
  }

  if (updates.length === 0) return;
  editor.transact(() => {
    for (const u of updates) editor.updateShape(u.id, { index: u.index });
  });
}

function currentOrder(editor: Editor): string[] {
  return editor.getShapes().map((s) => s.id); // getShapes() is z-sorted
}

export function bringToFront(editor: Editor, ids: string[]): void {
  const sel = new Set(ids);
  const order = currentOrder(editor);
  applyOrder(editor, [
    ...order.filter((id) => !sel.has(id)),
    ...order.filter((id) => sel.has(id)),
  ]);
}

export function sendToBack(editor: Editor, ids: string[]): void {
  const sel = new Set(ids);
  const order = currentOrder(editor);
  applyOrder(editor, [
    ...order.filter((id) => sel.has(id)),
    ...order.filter((id) => !sel.has(id)),
  ]);
}

export function bringForward(editor: Editor, ids: string[]): void {
  const sel = new Set(ids);
  const order = currentOrder(editor);
  for (let i = order.length - 2; i >= 0; i--) {
    if (sel.has(order[i]!) && !sel.has(order[i + 1]!)) {
      [order[i], order[i + 1]] = [order[i + 1]!, order[i]!];
    }
  }
  applyOrder(editor, order);
}

export function sendBackward(editor: Editor, ids: string[]): void {
  const sel = new Set(ids);
  const order = currentOrder(editor);
  for (let i = 1; i < order.length; i++) {
    if (sel.has(order[i]!) && !sel.has(order[i - 1]!)) {
      [order[i], order[i - 1]] = [order[i - 1]!, order[i]!];
    }
  }
  applyOrder(editor, order);
}
