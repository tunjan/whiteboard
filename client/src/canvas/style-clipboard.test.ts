import { describe, expect, it } from 'vitest';
import type { Shape } from '@whiteboard/shared';
import './shapes/register';
import type { Editor, ShapePatch } from './editor';
import { copyStyle, hasCopiedStyle, pasteStyle } from './style-clipboard';

function makeEditor(shapes: Shape[]): Editor {
  const map = new Map(shapes.map((s) => [s.id, s]));
  return {
    getShape: (id) => map.get(id),
    getShapes: () =>
      [...map.values()].sort((a, b) =>
        a.index < b.index ? -1 : a.index > b.index ? 1 : 0,
      ),
    createShape: (s) => void map.set(s.id, s),
    updateShape: (id, patch: ShapePatch) => {
      const s = map.get(id);
      if (!s) return;
      map.set(id, {
        ...s,
        ...patch,
        props: patch.props ? { ...s.props, ...patch.props } : s.props,
      } as Shape);
    },
    deleteShapes: (ids) => ids.forEach((id) => map.delete(id)),
    transact: (fn) => fn(),
  };
}

let n = 0;
const base = (id: string) => ({
  id,
  x: 0,
  y: 0,
  rotation: 0,
  index: `a${n++}`,
  parentId: null,
});

const rect = (id: string, props: Record<string, unknown> = {}, rest = {}) =>
  ({
    ...base(id),
    type: 'rectangle' as const,
    ...rest,
    props: {
      w: 40,
      h: 20,
      color: '#111',
      fillStyle: 'none',
      dash: 'solid',
      size: 2,
      ...props,
    },
  }) as unknown as Shape;

const text = (id: string, props: Record<string, unknown> = {}) =>
  ({
    ...base(id),
    type: 'text' as const,
    props: {
      text: 'hi',
      color: '#111',
      fontSize: 24,
      fontFamily: 'sans',
      fontWeight: 400,
      sizingMode: 'auto',
      width: 0,
      align: 'start',
      ...props,
    },
  }) as unknown as Shape;

const props = (editor: Editor, id: string) =>
  editor.getShape(id)!.props as Record<string, unknown>;

describe('style clipboard', () => {
  it('carries colour, weight, fill, dash and opacity onto another shape', () => {
    const editor = makeEditor([
      rect(
        'src',
        { color: '#e11', fillStyle: 'hatch', dash: 'dashed', size: 6 },
        { opacity: 0.4 },
      ),
      rect('dst'),
    ]);
    copyStyle(editor, ['src']);
    expect(hasCopiedStyle()).toBe(true);
    pasteStyle(editor, ['dst']);
    expect(props(editor, 'dst')).toMatchObject({
      color: '#e11',
      fillStyle: 'hatch',
      dash: 'dashed',
      size: 6,
    });
    expect(editor.getShape('dst')!.opacity).toBe(0.4);
    // Geometry is never part of a style.
    expect(props(editor, 'dst').w).toBe(40);
  });

  it('drops properties the target type does not carry', () => {
    const editor = makeEditor([
      rect('src', { color: '#e11', fillStyle: 'solid', size: 9 }),
      text('dst'),
    ]);
    copyStyle(editor, ['src']);
    pasteStyle(editor, ['dst']);
    const after = props(editor, 'dst');
    expect(after.color).toBe('#e11');
    // Text declares neither of these: stroke weight is the pen's, and a text
    // box has no interior to paint.
    expect(after.size).toBeUndefined();
    expect(after.fillStyle).toBeUndefined();
    expect(after.fontSize).toBe(24);
  });

  it('copies a font from a text and leaves a stroke weight behind', () => {
    const editor = makeEditor([
      text('src', {
        fontFamily: 'hand',
        fontWeight: 700,
        align: 'middle',
        color: '#07f',
      }),
      rect('dst'),
      text('dstText'),
    ]);
    copyStyle(editor, ['src']);
    pasteStyle(editor, ['dst', 'dstText']);
    expect(props(editor, 'dstText')).toMatchObject({
      fontFamily: 'hand',
      fontWeight: 700,
      align: 'middle',
      color: '#07f',
    });
    // The rectangle takes the colour and nothing else from a text's style.
    expect(props(editor, 'dst').color).toBe('#07f');
    expect(props(editor, 'dst').fontFamily).toBeUndefined();
    expect(props(editor, 'dst').dash).toBe('solid');
  });

  it('reaches the children of a selected group and skips locked shapes', () => {
    const editor = makeEditor([
      rect('src', { color: '#e11' }),
      { ...base('g'), type: 'group' as const, props: {} } as unknown as Shape,
      rect('child', {}, { parentId: 'g' }),
      rect('lockedChild', {}, { parentId: 'g', locked: true }),
    ]);
    copyStyle(editor, ['src']);
    pasteStyle(editor, ['g']);
    expect(props(editor, 'child').color).toBe('#e11');
    expect(props(editor, 'lockedChild').color).toBe('#111');
  });
});
