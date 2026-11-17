import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { describeActions, type AgentAction, type ArrowShape, type RectangleShape } from '@whiteboard/shared';
import './shapes/register';
import { applyAgentActions, boardSummary } from './agent-actions';
import { editor, loadBoard, undo } from './use-document-store';
import { useSelectionStore } from './use-selection-store';

// The generation pipeline (image model, cut-out review, upload) has its own
// path; here it hands back a library entry, or null when cancelled.
const generateSticker = vi.hoisted(() => vi.fn());
vi.mock('@/board/custom-stickers', () => ({ generateSticker }));

// MathJax is not what is under test: every formula typesets to one fixed box.
vi.mock('./equation-render', () => ({
  typesetEquation: async () => ({ svg: '<svg/>', width: 200, height: 40 }),
}));

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  } as Storage;
}

const rect: RectangleShape = {
  id: 'r1',
  type: 'rectangle',
  x: 0,
  y: 0,
  rotation: 0,
  index: 'a1',
  props: { w: 100, h: 50, color: '#1d1d1d', fillStyle: 'none', dash: 'solid', size: 2 },
};

let dispose: () => void;
beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('sessionStorage', memoryStorage());
  vi.stubGlobal('window', { innerWidth: 1000, innerHeight: 800 });
  dispose = loadBoard('test-agent', { persist: false, collab: false });
});
afterEach(() => dispose());

describe('applyAgentActions', () => {
  it('pulls a new shape into view unless told to keep its place', async () => {
    const at = (id: string) => editor.getShape(id)!.x;
    await applyAgentActions(editor, [{ type: 'create_equation', latex: 'x', x: 950, y: 100 }]);
    const pulled = useSelectionStore.getState().selectedIds[0]!;
    expect(at(pulled)).toBeLessThan(950);

    // A correction beside a line near the edge: pulled in, it covered the line.
    await applyAgentActions(editor, [{ type: 'create_equation', latex: 'y', x: 950, y: 100 }], {
      exact: true,
    });
    expect(at(useSelectionStore.getState().selectedIds[0]!)).toBe(950);
  });

  it('applies a whole instruction as one undo step', async () => {
    editor.createShape(rect);
    const actions: AgentAction[] = [
      { type: 'create_equation', latex: 'x^2' },
      { type: 'create_graph', expressions: ['y = x^2'] },
      { type: 'update_shape', id: 'r1', x: 300, color: 'red' },
    ];
    expect(await applyAgentActions(editor, actions)).toBe(3);

    const shapes = editor.getShapes();
    expect(shapes.map((s) => s.type)).toEqual(['rectangle', 'equation', 'graph']);
    expect(shapes[1]!.props).toMatchObject({ latex: 'x^2', w: expect.any(Number) });
    // Positions are the drawn bounds the summary reported, stroke included.
    expect(editor.getShape('r1')).toMatchObject({ x: 301, props: { color: '#e03131' } });
    expect(useSelectionStore.getState().selectedIds).toEqual(shapes.slice(1).map((s) => s.id));

    undo();
    expect(editor.getShapes()).toEqual([rect]);
  });

  it('skips actions on shapes that are gone', async () => {
    const applied = await applyAgentActions(editor, [
      { type: 'update_shape', id: 'missing', x: 1 },
      { type: 'delete_shapes', ids: ['missing'] },
      { type: 'create_arrow', from: { shapeId: 'missing' }, to: { x: 0, y: 0 } },
    ]);
    expect(applied).toBe(0);
    expect(editor.getShapes()).toEqual([]);
  });

  it('binds an arrow to the shape it names', async () => {
    editor.createShape(rect);
    await applyAgentActions(editor, [
      { type: 'create_arrow', from: { shapeId: 'r1' }, to: { x: 400, y: 25 } },
    ]);
    const arrow = editor.getShapes().find((s): s is ArrowShape => s.type === 'arrow');
    expect(arrow?.props.bindings?.start?.shapeId).toBe('r1');
    // Starts on the rectangle's right edge, not its centre.
    expect(arrow?.x).toBeCloseTo(100);
  });

  it('deletes what it is told to', async () => {
    editor.createShape(rect);
    await applyAgentActions(editor, [{ type: 'delete_shapes', ids: ['r1'] }]);
    expect(editor.getShapes()).toEqual([]);
  });

  it('aligns, groups and frames what it names, as one step', async () => {
    editor.createShape(rect);
    editor.createShape({ ...rect, id: 'r2', index: 'a2', x: 40, y: 200 });
    const applied = await applyAgentActions(editor, [
      { type: 'align_shapes', ids: ['r1', 'r2'], align: 'right' },
      { type: 'update_shape', id: 'r2', fillStyle: 'hatch' },
      { type: 'group_shapes', ids: ['r1', 'r2'] },
      { type: 'create_frame', name: 'Part a', ids: ['r1', 'r2'] },
    ]);
    expect(applied).toBe(4);
    expect(editor.getShape('r1')!.x).toBe(40);
    expect(editor.getShape('r2')!.props).toMatchObject({ fillStyle: 'hatch' });
    const group = editor.getShapes().find((s) => s.type === 'group')!;
    const frame = editor.getShapes().find((s) => s.type === 'frame')!;
    expect(editor.getShape('r1')!.parentId).toBe(group.id);
    expect(group.parentId).toBe(frame.id);
    expect(frame.props).toMatchObject({ name: 'Part a' });
    undo();
    expect(editor.getShapes().map((s) => s.id)).toEqual(['r1', 'r2']);
  });
});

describe('generated stickers', () => {
  it('places the library entry once it is ready, sized as asked', async () => {
    generateSticker.mockResolvedValueOnce({ id: 'cat', blobId: 'blob-cat', width: 400, height: 200 });
    const applied = await applyAgentActions(editor, [
      { type: 'create_text', text: 'Cats' },
      { type: 'generate_sticker', prompt: 'a cute cat', size: 120 },
    ]);
    expect(applied).toBe(2);
    expect(generateSticker).toHaveBeenCalledWith('a cute cat');
    const sticker = editor.getShapes().find((s) => s.type === 'sticker');
    expect(sticker?.props).toEqual({ sticker: 'cat', blobId: 'blob-cat', w: 120, h: 60 });
    expect(useSelectionStore.getState().selectedIds).toHaveLength(2);
  });

  it('adds nothing when the review is cancelled', async () => {
    generateSticker.mockResolvedValueOnce(null);
    expect(await applyAgentActions(editor, [{ type: 'generate_sticker', prompt: 'a dog' }])).toBe(0);
    expect(editor.getShapes()).toEqual([]);
  });
});

describe('boardSummary', () => {
  it('describes shapes by bounds and content', () => {
    editor.createShape(rect);
    useSelectionStore.getState().setSelection(['r1']);
    const summary = boardSummary(editor);
    expect(summary.selection).toEqual(['r1']);
    expect(summary.shapes).toEqual([
      { id: 'r1', type: 'rectangle', x: -1, y: -1, w: 102, h: 52, color: '#1d1d1d' },
    ]);
    expect(summary.omitted).toBe(0);
  });
});

describe('describeActions', () => {
  it('says what was added, changed and deleted', () => {
    expect(describeActions([{ type: 'create_equation', latex: 'x' }])).toBe('Added an equation');
    expect(
      describeActions([
        { type: 'create_equation', latex: 'x' },
        { type: 'create_arrow', from: { x: 0, y: 0 }, to: { x: 1, y: 1 } },
        { type: 'create_arrow', from: { x: 0, y: 0 }, to: { x: 1, y: 1 } },
        { type: 'create_sticker', sticker: 'a' },
        { type: 'generate_sticker', prompt: 'b' },
      ]),
    ).toBe('Added an equation, 2 arrows and 2 stickers');
    expect(
      describeActions([
        { type: 'update_shape', id: 'a' },
        { type: 'delete_shapes', ids: ['a', 'b'] },
      ]),
    ).toBe('Changed an item, deleted 2 items');
    expect(describeActions([])).toBe('Done');
  });
});
