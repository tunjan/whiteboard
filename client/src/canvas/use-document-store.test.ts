import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DrawPoint,
  DrawShape,
  EquationShape,
  GroupShape,
  RectangleShape,
  TextShape,
} from '@whiteboard/shared';
import './shapes/register';
import {
  createPage,
  deletePage,
  documentByteSize,
  editor,
  loadBoard,
  redo,
  setCurrentPage,
  setCurrentPageForFollow,
  undo,
  useDocumentStore,
} from './use-document-store';
import { useCameraStore } from './use-camera-store';
import { beginLiveStroke, endLiveStroke } from './use-live-stroke-store';
import { useEnteredGroupStore } from './use-entered-group-store';
import { useSelectionStore } from './use-selection-store';
import { useTextEditingStore } from './use-text-editing-store';
import { registerPageSwitchInteractionCompleter } from './page-transition';
import { readPageSession } from './page-session-state';
import { useFollowStore } from '@/collab/use-follow-store';

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

function group(id: string): GroupShape {
  return {
    id,
    type: 'group',
    x: 0,
    y: 0,
    rotation: 0,
    index: 'a0',
    props: {},
  };
}

function equation(id: string, index: string): EquationShape {
  return {
    id,
    type: 'equation',
    x: 0,
    y: 0,
    rotation: 0,
    index,
    props: { latex: 'x^2', color: '#000000', fontSize: 16, w: 40, h: 20 },
  };
}

const stroke = (n: number): DrawPoint[] =>
  Array.from({ length: n }, (_, i) => ({ x: i, y: i * 2, pressure: 0.5 }));

const drawnPoints = (id: string): DrawPoint[] => {
  const shape = editor.getShape(id);
  return shape?.type === 'draw' ? shape.props.points : [];
};

const ids = () => useDocumentStore.getState().shapes.map((s) => s.id);

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

let dispose: () => void;
beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('sessionStorage', memoryStorage());
  dispose = loadBoard('test-doc-store', { persist: false, collab: false });
});
afterEach(() => dispose());

describe('page transitions', () => {
  it('finishes the current interaction and ignores unknown page ids', () => {
    let completed = 0;
    const unregister = registerPageSwitchInteractionCompleter(() => {
      completed += 1;
    });
    const firstPageId = useDocumentStore.getState().currentPageId;

    setCurrentPage('page-does-not-exist');
    expect(useDocumentStore.getState().currentPageId).toBe(firstPageId);
    expect(completed).toBe(0);

    const secondPageId = createPage('Page 2');
    expect(useDocumentStore.getState().currentPageId).toBe(secondPageId);
    expect(completed).toBe(1);
    unregister();
  });

  it('persists the exact last page selected or created for the board', () => {
    const firstPageId = useDocumentStore.getState().currentPageId;
    const secondPageId = createPage('Page 2');
    expect(readPageSession('test-doc-store')).toBe(secondPageId);

    setCurrentPage(firstPageId);
    expect(readPageSession('test-doc-store')).toBe(firstPageId);
  });

  it('restores each page camera, selection, entered group, and text editor', () => {
    const firstPageId = useDocumentStore.getState().currentPageId;
    editor.createShape(group('group-a'));
    editor.createShape(rect('rect-a', 'a1'));
    editor.createShape(text('text-a', 'hello'));
    useSelectionStore.getState().setSelection(['rect-a', 'text-a']);
    useEnteredGroupStore.getState().enter('group-a');
    useTextEditingStore.getState().start('text-a', { anchor: 1, head: 4 });
    useCameraStore.getState().setCamera({ x: 10, y: 20, z: 2 });

    const secondPageId = createPage('Page 2');
    expect(useSelectionStore.getState().selectedIds).toEqual([]);
    expect(useEnteredGroupStore.getState().enteredGroupId).toBeNull();
    expect(useTextEditingStore.getState().editingId).toBeNull();
    expect(useCameraStore.getState().camera).toEqual({ x: 0, y: 0, z: 1 });

    editor.createShape(rect('rect-b', 'a1'));
    useSelectionStore.getState().setSelection(['rect-b']);
    useCameraStore.getState().setCamera({ x: -30, y: 5, z: 0.5 });

    setCurrentPage(firstPageId);
    expect(useDocumentStore.getState().shapes.map((shape) => shape.id)).toEqual([
      'group-a',
      'rect-a',
      'text-a',
    ]);
    expect(useSelectionStore.getState().selectedIds).toEqual([
      'rect-a',
      'text-a',
    ]);
    expect(useEnteredGroupStore.getState().enteredGroupId).toBe('group-a');
    expect(useTextEditingStore.getState()).toMatchObject({
      editingId: 'text-a',
      anchor: 1,
      head: 4,
    });
    expect(useCameraStore.getState().camera).toEqual({ x: 10, y: 20, z: 2 });

    setCurrentPage(secondPageId);
    expect(useSelectionStore.getState().selectedIds).toEqual(['rect-b']);
    expect(useCameraStore.getState().camera).toEqual({ x: -30, y: 5, z: 0.5 });
  });

  it('keeps undo and redo history when switching away and back', () => {
    const firstPageId = useDocumentStore.getState().currentPageId;
    editor.createShape(rect('rect-a', 'a1'));
    const secondPageId = createPage('Page 2');
    editor.createShape(rect('rect-b', 'a1'));

    setCurrentPage(firstPageId);
    undo();
    expect(editor.getShape('rect-a')).toBeUndefined();

    setCurrentPage(secondPageId);
    expect(editor.getShape('rect-b')).toBeDefined();
    setCurrentPage(firstPageId);
    redo();
    expect(editor.getShape('rect-a')).toBeDefined();
  });

  it('falls back to the previous page and purges the deleted camera', () => {
    const firstPageId = useDocumentStore.getState().currentPageId;
    const secondPageId = createPage('Page 2');
    createPage('Page 3');
    setCurrentPage(secondPageId);
    useCameraStore.getState().setCamera({ x: 40, y: 50, z: 1.5 });

    deletePage(secondPageId);

    expect(useDocumentStore.getState().currentPageId).toBe(firstPageId);
    expect(
      useCameraStore.getState().cameras[`test-doc-store/${secondPageId}`],
    ).toBeUndefined();
  });

  it('ends follow mode for manual switches but preserves follow-driven switches', () => {
    const firstPageId = useDocumentStore.getState().currentPageId;
    const secondPageId = createPage('Page 2');

    useFollowStore.getState().setFollowing(true);
    setCurrentPage(firstPageId);
    expect(useFollowStore.getState().following).toBe(false);

    useFollowStore.getState().setFollowing(true);
    setCurrentPageForFollow(secondPageId);
    expect(useFollowStore.getState().following).toBe(true);
    useFollowStore.getState().setFollowing(false);
  });
});

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

describe('hierarchy and equation flags', () => {
  // These gate the Canvas's page-wide derivations, so a flag that drifts to
  // false while parented shapes exist stops frames rendering their children —
  // a correctness bug, not a slow frame. Every path that can change the count
  // is covered: create, reparent, unparent, delete, undo, and page switch.
  const flags = () => {
    const s = useDocumentStore.getState();
    return { hierarchy: s.hasHierarchy, equations: s.hasEquations };
  };

  it('stays false for a page of unparented shapes', () => {
    editor.createShape(rect('a', 'a1'));
    editor.createShape(rect('b', 'a2'));
    expect(flags()).toEqual({ hierarchy: false, equations: false });
  });

  it('tracks a shape being parented and then unparented', () => {
    editor.createShape(group('g'));
    editor.createShape(rect('a', 'a1'));
    expect(flags().hierarchy).toBe(false);

    editor.updateShape('a', { parentId: 'g' });
    expect(flags().hierarchy).toBe(true);

    // Ungrouping writes `parentId: null` rather than removing the key.
    editor.updateShape('a', { parentId: null });
    expect(flags().hierarchy).toBe(false);
  });

  it('does not double-count repeated writes to an already-parented shape', () => {
    editor.createShape(group('g'));
    editor.createShape(rect('a', 'a1'));
    editor.updateShape('a', { parentId: 'g' });
    editor.updateShape('a', { x: 1 });
    editor.updateShape('a', { x: 2 });
    editor.updateShape('a', { parentId: 'g' });
    expect(flags().hierarchy).toBe(true);

    // One unparent must be enough to clear it — a count inflated by the writes
    // above would leave the flag stuck on.
    editor.updateShape('a', { parentId: null });
    expect(flags().hierarchy).toBe(false);
  });

  it('clears when the only parented shape is deleted', () => {
    editor.createShape(group('g'));
    editor.createShape(rect('a', 'a1'));
    editor.updateShape('a', { parentId: 'g' });
    expect(flags().hierarchy).toBe(true);

    editor.deleteShapes(['a']);
    expect(flags().hierarchy).toBe(false);
  });

  it('survives undo and redo of a reparent', () => {
    editor.createShape(group('g'));
    editor.createShape(rect('a', 'a1'));
    editor.updateShape('a', { parentId: 'g' });
    expect(flags().hierarchy).toBe(true);

    undo();
    expect(flags().hierarchy).toBe(false);
    redo();
    expect(flags().hierarchy).toBe(true);
  });

  it('recomputes per page rather than leaking across a switch', () => {
    editor.createShape(group('g'));
    editor.createShape(rect('a', 'a1'));
    editor.updateShape('a', { parentId: 'g' });
    const first = useDocumentStore.getState().currentPageId;
    expect(flags().hierarchy).toBe(true);

    const second = createPage();
    setCurrentPage(second);
    expect(flags().hierarchy).toBe(false);

    setCurrentPage(first);
    expect(flags().hierarchy).toBe(true);
  });

  it('tracks equations independently of hierarchy', () => {
    editor.createShape(rect('a', 'a1'));
    expect(flags().equations).toBe(false);

    editor.createShape(equation('eq', 'a2'));
    expect(flags()).toEqual({ hierarchy: false, equations: true });

    editor.deleteShapes(['eq']);
    expect(flags().equations).toBe(false);
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

  it('stores points as flat triples, not keyed objects', () => {
    // Yjs encodes a bare number far more compactly than a three-key map entry,
    // and the decode restores the same values, so rendering is unchanged.
    const before = documentByteSize();
    editor.createShape(draw('s', stroke(300)));
    const bytes = documentByteSize() - before;

    expect(drawnPoints('s')).toEqual(stroke(300));
    // The object form measured ~12.6KB for this stroke.
    expect(bytes).toBeLessThan(9_000);
  });
});

describe('the stroke the local pointer is drawing', () => {
  afterEach(() => endLiveStroke());

  it('reaches the document every frame without republishing the snapshot', () => {
    editor.createShape(draw('live', stroke(2)));
    beginLiveStroke('live');
    const published = useDocumentStore.getState().shapes;

    for (let n = 3; n <= 12; n++) {
      editor.updateShape('live', { props: { points: stroke(n) } });
      // The write is what peers watch, so it must land on every frame...
      expect(drawnPoints('live')).toHaveLength(n);
      // ...while locally the active-stroke layer is already drawing it, so
      // rebuilding the page's derived state to say so would be pure cost.
      expect(useDocumentStore.getState().shapes).toBe(published);
    }
  });

  it('still publishes when anything else changes', () => {
    editor.createShape(draw('live', stroke(2)));
    beginLiveStroke('live');
    const published = useDocumentStore.getState().shapes;

    // A peer's edit, an arrow rerouting, an eraser — none of it may be held up
    // behind somebody's pen.
    editor.createShape(rect('other', 'a2'));
    expect(useDocumentStore.getState().shapes).not.toBe(published);
  });

  it('publishes the settled stroke once the tool releases it', () => {
    editor.createShape(draw('live', stroke(2)));
    beginLiveStroke('live');
    editor.updateShape('live', { props: { points: stroke(40) } });

    // The tool clears the id first and writes the final points after, so that
    // write publishes like any other and React shows the document copy and the
    // unmounted layer in one commit.
    endLiveStroke();
    editor.updateShape('live', { props: { points: stroke(41) } });

    const shape = useDocumentStore.getState().shapes.find((s) => s.id === 'live');
    expect(shape?.type === 'draw' && shape.props.points).toHaveLength(41);
  });
});
