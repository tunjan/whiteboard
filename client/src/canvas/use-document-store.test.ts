import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  DrawPoint,
  DrawShape,
  RectangleShape,
  TextShape,
} from '@whiteboard/shared';
import './shapes/register';
import {
  documentByteSize,
  editor,
  loadBoard,
  useDocumentStore,
} from './use-document-store';

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

function draw(id: string, points: DrawPoint[]): DrawShape {
  return {
    id,
    type: 'draw',
    x: 0,
    y: 0,
    rotation: 0,
    index: 'a1',
    props: { points, isClosed: false, color: '#000000', size: 4 },
  };
}

const stroke = (n: number): DrawPoint[] =>
  Array.from({ length: n }, (_, i) => ({ x: i, y: i * 2, pressure: 0.5 }));

const drawnPoints = (id: string): DrawPoint[] => {
  const shape = editor.getShape(id);
  return shape?.type === 'draw' ? shape.props.points : [];
};

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

describe('ink points storage', () => {
  const N = 200;

  it('grows linearly, not quadratically, as a stroke is drawn', () => {
    // The draw tool rewrites the full point array once per frame. Stored inside
    // `props`, each write re-encoded the whole array, so a stroke cost O(n²)
    // document bytes. As a Y.Array each write appends only the new points.
    const baseline = documentByteSize();
    editor.createShape(draw('live', []));
    const points: DrawPoint[] = [];
    for (const p of stroke(N)) {
      points.push(p);
      editor.updateShape('live', { props: { points: [...points] } });
    }
    const incremental = documentByteSize() - baseline;

    // Same stroke, written once — the floor for storing N points at all.
    const single = documentByteSize();
    editor.createShape(draw('oneshot', stroke(N)));
    const oneShot = documentByteSize() - single;

    expect(drawnPoints('live')).toEqual(stroke(N));
    // Quadratic growth would put this ratio near N/2 (~100x). Appending keeps
    // it near 1x, plus per-insert framing overhead.
    expect(incremental / oneShot).toBeLessThan(4);
  });

  it('replaces the array when the new points are not an extension', () => {
    // What commit-time simplification does: rewrite the stroke with fewer points.
    editor.createShape(draw('s', stroke(N)));
    const simplified = stroke(N).filter((_, i) => i % 5 === 0);
    editor.updateShape('s', { props: { points: simplified } });
    expect(drawnPoints('s')).toEqual(simplified);
  });

  it('round-trips an append followed by an unrelated prop change', () => {
    editor.createShape(draw('s', stroke(3)));
    editor.updateShape('s', { props: { points: stroke(6) } });
    editor.updateShape('s', { props: { color: '#ff0000' } });
    const shape = editor.getShape('s');
    expect(shape?.type).toBe('draw');
    if (shape?.type !== 'draw') return;
    expect(shape.props.points).toEqual(stroke(6));
    expect(shape.props.color).toBe('#ff0000');
  });

  it('handles an empty stroke and a single point', () => {
    editor.createShape(draw('empty', []));
    expect(drawnPoints('empty')).toEqual([]);
    editor.updateShape('empty', { props: { points: stroke(1) } });
    expect(drawnPoints('empty')).toEqual(stroke(1));
  });
});
