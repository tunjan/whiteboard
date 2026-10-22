import { describe, expect, it } from 'vitest';
import type { Shape } from '@whiteboard/shared';
import './shapes/register';
import { copyShapes, pasteAtContextMenu, setContextMenuPoint } from './clipboard';
import type { Editor } from './editor';

function makeEditor(initial: Shape[]): Editor {
  const map = new Map(initial.map((s) => [s.id, s]));
  return {
    getShape: (id) => map.get(id),
    getShapes: () => [...map.values()],
    createShape: (s) => void map.set(s.id, s),
    updateShape: (id, patch) => {
      const s = map.get(id);
      if (s) map.set(id, { ...s, ...patch } as Shape);
    },
    deleteShapes: (ids) => ids.forEach((id) => map.delete(id)),
    transact: (fn) => fn(),
  };
}

describe('pasteAtContextMenu', () => {
  it('centres the paste on the right-click point', () => {
    const editor = makeEditor([
      {
        id: 'r',
        type: 'rectangle',
        x: 0,
        y: 0,
        rotation: 0,
        index: 'a0',
        props: { w: 40, h: 20, color: '#111', fillStyle: 'none', dash: 'solid', size: 2 },
      } as Shape,
    ]);
    copyShapes(editor, ['r']);
    setContextMenuPoint({ x: 500, y: 300 });
    const [id] = pasteAtContextMenu(editor);
    expect(editor.getShape(id!)).toMatchObject({ x: 480, y: 290 });
  });
});

describe('pasting a bound arrow', () => {
  const box = {
    id: 'box',
    type: 'rectangle',
    x: 0,
    y: 0,
    rotation: 0,
    index: 'a0',
    props: { w: 40, h: 20, color: '#111', fillStyle: 'none', dash: 'solid', size: 2 },
  } as Shape;
  const arrow = {
    id: 'arrow',
    type: 'arrow',
    x: 100,
    y: 0,
    rotation: 0,
    index: 'a1',
    props: {
      points: [{ x: 0, y: 0 }, { x: 50, y: 0 }],
      bindings: { start: { shapeId: 'box', anchor: { x: 0.5, y: 0.5 } }, end: null },
    },
  } as unknown as Shape;
  const startTarget = (editor: Editor, id: string) =>
    (editor.getShape(id)!.props as { bindings: { start: { shapeId: string } | null } })
      .bindings.start?.shapeId;

  it('drops a binding to a target that was not copied', () => {
    const editor = makeEditor([box, arrow]);
    copyShapes(editor, ['arrow']);
    setContextMenuPoint({ x: 500, y: 300 });
    const [id] = pasteAtContextMenu(editor);
    expect(startTarget(editor, id!)).toBeUndefined();
  });

  it('follows a target that was copied with it', () => {
    const editor = makeEditor([box, arrow]);
    copyShapes(editor, ['box', 'arrow']);
    setContextMenuPoint({ x: 500, y: 300 });
    const ids = pasteAtContextMenu(editor);
    const pastedArrow = ids.find((id) => editor.getShape(id)!.type === 'arrow')!;
    const pastedBox = ids.find((id) => editor.getShape(id)!.type === 'rectangle');
    expect(startTarget(editor, pastedArrow)).toBe(pastedBox);
  });
});
