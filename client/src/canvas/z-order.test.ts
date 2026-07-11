import { describe, expect, it } from 'vitest';
import { generateNKeysBetween } from 'fractional-indexing';
import type { Shape } from '@whiteboard/shared';
import type { Editor } from './editor';
import { bringForward, bringToFront, sendBackward, sendToBack } from './z-order';

/** Minimal in-memory editor backed by a map; only the bits z-order touches. */
function makeEditor(ids: string[]): Editor {
  const keys = generateNKeysBetween(null, null, ids.length);
  const map = new Map<string, Shape>();
  ids.forEach((id, i) => {
    map.set(id, {
      id,
      type: 'rectangle',
      x: 0,
      y: 0,
      rotation: 0,
      index: keys[i]!,
      props: {},
    } as unknown as Shape);
  });
  return {
    getShape: (id) => map.get(id),
    getShapes: () =>
      [...map.values()].sort((a, b) =>
        a.index < b.index ? -1 : a.index > b.index ? 1 : 0,
      ),
    createShape: (s) => void map.set(s.id, s),
    updateShape: (id, patch) => {
      const s = map.get(id);
      if (s && patch.index !== undefined) map.set(id, { ...s, index: patch.index });
    },
    deleteShapes: (dids) => dids.forEach((d) => map.delete(d)),
    transact: (fn) => fn(),
  };
}

const order = (editor: Editor): string[] => editor.getShapes().map((s) => s.id);
const indexOf = (editor: Editor, id: string): string => editor.getShape(id)!.index;

describe('z-order', () => {
  it('bringToFront moves the selection above everything, preserving order', () => {
    const editor = makeEditor(['a', 'b', 'c', 'd']);
    bringToFront(editor, ['a', 'c']);
    expect(order(editor)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('sendToBack moves the selection below everything, preserving order', () => {
    const editor = makeEditor(['a', 'b', 'c', 'd']);
    sendToBack(editor, ['b', 'd']);
    expect(order(editor)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('bringForward moves each selected shape up one slot', () => {
    const editor = makeEditor(['a', 'b', 'c', 'd']);
    bringForward(editor, ['a']);
    expect(order(editor)).toEqual(['b', 'a', 'c', 'd']);
  });

  it('sendBackward moves each selected shape down one slot', () => {
    const editor = makeEditor(['a', 'b', 'c', 'd']);
    sendBackward(editor, ['d']);
    expect(order(editor)).toEqual(['a', 'b', 'd', 'c']);
  });

  it('only renumbers shapes that actually moved (conflict-free keys)', () => {
    const editor = makeEditor(['a', 'b', 'c', 'd']);
    const aKey = indexOf(editor, 'a');
    bringToFront(editor, ['c']);
    expect(order(editor)).toEqual(['a', 'b', 'd', 'c']);
    // 'a' sits below the moved shapes and must keep its original key untouched.
    expect(indexOf(editor, 'a')).toBe(aKey);
  });

  it('is a no-op (no rekeying) when the selection is already on top', () => {
    const editor = makeEditor(['a', 'b', 'c', 'd']);
    const before = editor.getShapes().map((s) => [s.id, s.index] as const);
    bringToFront(editor, ['d']);
    const after = editor.getShapes().map((s) => [s.id, s.index] as const);
    expect(after).toEqual(before);
  });
});
