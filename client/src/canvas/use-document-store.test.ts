import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RectangleShape, TextShape } from '@whiteboard/shared';
import './shapes/register';
import { editor, loadBoard, useDocumentStore } from './use-document-store';

function rect(id: string, index: string): RectangleShape {
  return {
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    rotation: 0,
    index,
    props: { w: 10, h: 10, color: '#000000', fillStyle: 'none', dash: 'solid', size: 2 },
  };
}

function text(id: string, value: string): TextShape {
  return {
    id,
    type: 'text',
    x: 0,
    y: 0,
    rotation: 0,
    index: 'a1',
    props: {
      text: value,
      color: '#000000',
      fontSize: 24,
      fontFamily: 'sans',
      sizingMode: 'auto',
      width: 0,
      lineHeight: 1.2,
      align: 'start',
    },
  };
}

const ids = () => useDocumentStore.getState().shapes.map((s) => s.id);

let dispose: () => void;
beforeEach(() => {
  dispose = loadBoard('test-doc-store', { persist: false, collab: false });
});
afterEach(() => dispose());

describe('document store snapshot', () => {
  it('applies an index-unchanged update incrementally, preserving order and untouched identities', () => {
    editor.createShape(rect('a', 'a1'));
    editor.createShape(rect('b', 'a2'));
    editor.createShape(rect('c', 'a3'));
    const before = useDocumentStore.getState().shapes;
    expect(before.map((s) => s.id)).toEqual(['a', 'b', 'c']);

    // Moving a shape changes x/y but not its z-`index`: the incremental branch
    // must swap only that entry and keep the rest (order + object identity).
    editor.updateShape('b', { x: 999 });
    const after = useDocumentStore.getState().shapes;

    expect(after).not.toBe(before); // fresh array so subscribers re-render
    expect(after.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(after.find((s) => s.id === 'b')!.x).toBe(999);
    expect(after.find((s) => s.id === 'a')).toBe(before.find((s) => s.id === 'a'));
    expect(after.find((s) => s.id === 'c')).toBe(before.find((s) => s.id === 'c'));
  });

  it('re-sorts when a shape index changes', () => {
    editor.createShape(rect('a', 'a1'));
    editor.createShape(rect('b', 'a2'));
    expect(ids()).toEqual(['a', 'b']);

    editor.updateShape('a', { index: 'a3' }); // move a after b
    expect(ids()).toEqual(['b', 'a']);
  });

  it('reflects creations and deletions in the snapshot', () => {
    editor.createShape(rect('a', 'a1'));
    editor.createShape(rect('b', 'a2'));
    expect(ids()).toEqual(['a', 'b']);

    editor.deleteShapes(['a']);
    expect(ids()).toEqual(['b']);
  });

  it('round-trips text through its Y.Text sequence and preserves other props', () => {
    editor.createShape(text('text-a', 'Hello'));
    editor.updateShape('text-a', { props: { text: 'Hello world' } });
    editor.updateShape('text-a', { props: { align: 'middle' } });

    const shape = editor.getShape('text-a');
    expect(shape?.type).toBe('text');
    if (shape?.type !== 'text') return;
    expect(shape.props.text).toBe('Hello world');
    expect(shape.props.align).toBe('middle');
  });
});
