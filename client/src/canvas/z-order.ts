import { generateNKeysBetween } from 'fractional-indexing';
import type { Editor } from './editor';

/** Reassign fractional indices to match `orderedIds` (ascending z-order). */
function applyOrder(editor: Editor, orderedIds: string[]): void {
  if (orderedIds.length === 0) return;
  const keys = generateNKeysBetween(null, null, orderedIds.length);
  orderedIds.forEach((id, i) => editor.updateShape(id, { index: keys[i]! }));
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
