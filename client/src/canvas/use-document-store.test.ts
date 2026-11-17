import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ArrowShape,
  DrawPoint,
  DrawShape,
  EquationShape,
  FrameShape,
  GroupShape,
  RectangleShape,
  Shape,
  TextShape,
} from '@whiteboard/shared';
import { packShapeBase, readShapeBase, SHAPE_BASE_KEY } from '@whiteboard/shared';
import './shapes/register';
import {
  createPage,
  deletePage,
  duplicatePage,
  moveShapesToPage,
} from './page-actions';
import {
  compareIndex,
  currentSession,
  documentByteSize,
  editor,
  loadBoard,
  migrateLegacyPageShapes,
  redo,
  setCurrentPage,
  spatialIndex,
  setCurrentPageForFollow,
  undo,
  useDocumentStore,
} from './use-document-store';
import { addComment, addCommentReply } from './board-records';
import { shapeStore } from './engine/shape-store';
import * as Y from 'yjs';
import { useBoardLoadingStore } from '@/board/use-board-loading-store';
import { residentPageDoc } from './page-docs';
import { useCameraStore } from './use-camera-store';
import { useCommentsStore } from './use-comments-store';
import { beginLiveStroke, endLiveStroke } from './use-live-stroke-store';
import { useEnteredGroupStore } from './use-entered-group-store';
import { useEraserCutStore } from './use-eraser-cut-store';
import { useEraserStore } from './use-eraser-store';
import { useHiddenStore } from './use-hidden-store';
import { ERASE_DIM } from './opacity';
import { VANISH_MS, clearVanishing, useVanishStore } from './use-vanish-store';
import { useSelectionStore } from './use-selection-store';
import { useTextEditingStore } from './use-text-editing-store';
import { registerPageSwitchInteractionCompleter } from './page-transition';
import { readPageSession } from './page-session-state';
import { useFollowStore } from '@/collab/use-follow-store';
import { invalidateTextMetrics } from './shapes/text-measure';
import { legacyShapesMapName } from './page-migration';
import { shapeToY } from './shape-yjs';
import { setBoardAccess } from '@/board/board-access';

function rect(id: string, index: string): RectangleShape {
  return {
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    rotation: 0,
    index,
    props: {
      w: 10,
      h: 10,
      color: '#000000',
      fillStyle: 'none',
      dash: 'solid',
      size: 2,
    },
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

function arrow(
  id: string,
  bindings?: ArrowShape['props']['bindings'],
): ArrowShape {
  return {
    id,
    type: 'arrow',
    x: 0,
    y: 0,
    rotation: 0,
    index: 'a2',
    props: {
      points: [
        { x: 0, y: 0 },
        { x: 50, y: 50 },
      ],
      color: '#000000',
      size: 2,
      dash: 'solid',
      arrowStart: false,
      arrowEnd: true,
      bend: 0,
      ...(bindings ? { bindings } : {}),
    },
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

const ids = () => shapeStore.sorted.get().map((s) => s.id);

const box = (minX: number, minY: number, maxX: number, maxY: number) => ({
  minX,
  minY,
  maxX,
  maxY,
});

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

describe('board loading readiness', () => {
  // A board with neither a local cache nor a server has no source to wait for,
  // so the loading veil must never come up over it — including here, where
  // every other suite in this file relies on the board being usable at once.
  it('is ready immediately for a board with no configured source', () => {
    expect(useBoardLoadingStore.getState().ready).toBe(true);
  });

  it('is not ready again once the board is disposed', () => {
    dispose();
    expect(useBoardLoadingStore.getState().ready).toBe(false);
    dispose = loadBoard('test-doc-store', { persist: false, collab: false });
  });
});

describe('legacy page migration', () => {
  afterEach(() => setBoardAccess('pending'));

  function plantLegacyShape() {
    const pageId = useDocumentStore.getState().currentPageId;
    const legacy = currentSession()!.doc.getMap(legacyShapesMapName(pageId));
    legacy.set('rect-a', shapeToY(rect('rect-a', 'a1')));
    return { pageId, legacy };
  }

  it('moves legacy shapes onto the open page', async () => {
    const { pageId, legacy } = plantLegacyShape();
    migrateLegacyPageShapes(pageId);
    await Promise.resolve();
    expect(legacy.size).toBe(0);
    expect(editor.getShape('rect-a')).toBeDefined();
  });

  it('writes nothing from a view-only link', async () => {
    const { pageId, legacy } = plantLegacyShape();
    setBoardAccess('view');
    migrateLegacyPageShapes(pageId);
    await Promise.resolve();
    expect(legacy.size).toBe(1);
    expect(editor.getShape('rect-a')).toBeUndefined();
  });
});

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
    expect(shapeStore.sorted.get().map((shape) => shape.id)).toEqual(
      ['group-a', 'rect-a', 'text-a'],
    );
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

  it('brings a page back with its derived state, still live', () => {
    const firstPageId = useDocumentStore.getState().currentPageId;
    editor.createShape(rect('rect-a', 'a1'));
    editor.createShape({ ...rect('rect-b', 'a2'), x: 100, y: 100 });

    const secondPageId = createPage('Page 2');
    // Each page has its own document: page 2 sees none of page 1's shapes, and
    // nothing of page 1 is left in the spatial index behind it.
    expect(ids()).toEqual([]);
    expect(spatialIndex.size).toBe(0);

    setCurrentPage(firstPageId);
    expect(ids()).toEqual(['rect-a', 'rect-b']);
    expect(spatialIndex.search(box(-5, -5, 5, 5))).toEqual(['rect-a']);

    // Restored, not frozen: the page picks up edits where it left off.
    editor.updateShape('rect-a', { x: 200, y: 200 });
    expect(spatialIndex.search(box(-5, -5, 5, 5))).toEqual([]);
    expect(spatialIndex.search(box(195, 195, 205, 205))).toEqual(['rect-a']);

    setCurrentPage(secondPageId);
    expect(spatialIndex.size).toBe(0);
  });

  /** Apply `edit` to `pageId` the way a peer's update would arrive. */
  const peerEditsPage = (
    pageId: string,
    edit: (shapes: Y.Map<unknown>) => void,
  ) => {
    const page = residentPageDoc(pageId)!;
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(page.doc));
    peer.transact(() => edit(peer.getMap('shapes')));
    Y.applyUpdate(
      page.doc,
      Y.encodeStateAsUpdate(peer, Y.encodeStateVector(page.doc)),
      {},
    );
    peer.destroy();
  };

  it('patches in what a peer changed on a page while it was parked', () => {
    const firstPageId = useDocumentStore.getState().currentPageId;
    for (let i = 0; i < 8; i++)
      editor.createShape({ ...rect(`rect-${i}`, `a${i}`), x: i * 100 });
    const untouched = editor.getShape('rect-7');
    const secondPageId = createPage('Page 2');

    peerEditsPage(firstPageId, (shapes) => {
      const m = shapes.get('rect-0') as Y.Map<unknown>;
      const next = { ...readShapeBase(m), x: 5000 } as Record<string, unknown>;
      m.set(SHAPE_BASE_KEY, packShapeBase((field) => next[field]));
      shapes.delete('rect-1');
    });

    setCurrentPage(firstPageId);
    expect(ids()).toEqual(
      ['rect-0', 'rect-2', 'rect-3', 'rect-4', 'rect-5', 'rect-6', 'rect-7'],
    );
    expect(editor.getShape('rect-0')?.x).toBe(5000);
    expect(spatialIndex.search(box(4995, -5, 5005, 5))).toEqual(['rect-0']);
    expect(spatialIndex.search(box(95, -5, 105, 5))).toEqual([]);
    // Patched, not re-derived: a shape nobody touched is the same object.
    expect(editor.getShape('rect-7')).toBe(untouched);
    // The user never saw rect-1 go, so it does not fade out in front of them.
    expect(useVanishStore.getState().ghosts).toEqual([]);

    setCurrentPage(secondPageId);
    expect(spatialIndex.size).toBe(0);
  });

  it('re-derives a parked page a peer changed most of', () => {
    const firstPageId = useDocumentStore.getState().currentPageId;
    editor.createShape(rect('rect-a', 'a1'));
    editor.createShape(rect('rect-b', 'a2'));
    const untouched = editor.getShape('rect-b');
    createPage('Page 2');

    peerEditsPage(firstPageId, (shapes) => {
      const m = shapes.get('rect-a') as Y.Map<unknown>;
      const next = { ...readShapeBase(m), x: 300 } as Record<string, unknown>;
      m.set(SHAPE_BASE_KEY, packShapeBase((field) => next[field]));
    });

    setCurrentPage(firstPageId);
    expect(editor.getShape('rect-a')?.x).toBe(300);
    expect(spatialIndex.search(box(295, -5, 305, 5))).toEqual(['rect-a']);
    expect(editor.getShape('rect-b')).not.toBe(untouched);
    expect(editor.getShape('rect-b')).toEqual(untouched);
  });

  it('re-derives a parked page once text metrics change', () => {
    const firstPageId = useDocumentStore.getState().currentPageId;
    editor.createShape(rect('rect-a', 'a1'));
    const untouched = editor.getShape('rect-a');
    createPage('Page 2');

    invalidateTextMetrics();

    setCurrentPage(firstPageId);
    expect(editor.getShape('rect-a')).not.toBe(untouched);
    expect(editor.getShape('rect-a')).toEqual(untouched);
  });

  it('publishes shape edits without waking the zustand store', () => {
    editor.createShape(rect('rect-a', 'a1'));
    const listener = vi.fn();
    const stop = useDocumentStore.subscribe(listener);
    editor.updateShape('rect-a', { x: 5 });
    stop();
    expect(shapeStore.peek('rect-a')?.x).toBe(5);
    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps an uploaded image blob id when a stale gesture writes it back empty', () => {
    const pending = { blobId: '', w: 10, h: 10, naturalWidth: 10, naturalHeight: 10 };
    editor.createShape({
      id: 'img',
      type: 'image',
      x: 0,
      y: 0,
      rotation: 0,
      index: 'a1',
      props: pending,
    } as Shape);
    editor.updateShape('img', { props: { blobId: 'blob-1', thumbBlobId: 'thumb-1' } });
    // A resize that began before the upload landed sends its starting props.
    editor.updateShape('img', { props: { ...pending, w: 20 } });
    const props = editor.getShape('img')!.props as Record<string, unknown>;
    expect(props).toMatchObject({ blobId: 'blob-1', thumbBlobId: 'thumb-1', w: 20 });
  });

  it('publishes the shape lookup of the page that is open', () => {
    const firstPageId = useDocumentStore.getState().currentPageId;
    editor.createShape(rect('rect-a', 'a1'));
    expect(shapeStore.peek('rect-a')).toBeDefined();

    const secondPageId = createPage('Page 2');
    // Consumers read shapes through this map; left pointing at the page just
    // left, every lookup would answer for the wrong page.
    expect(
      shapeStore.peek('rect-a'),
    ).toBeUndefined();
    editor.createShape(rect('rect-b', 'a1'));
    expect(shapeStore.peek('rect-b')).toBeDefined();

    setCurrentPage(firstPageId);
    expect(shapeStore.peek('rect-a')).toBeDefined();
    expect(
      shapeStore.peek('rect-b'),
    ).toBeUndefined();

    expect(secondPageId).not.toBe(firstPageId);
  });

  it('keeps each page undo history separate across switches', () => {
    const firstPageId = useDocumentStore.getState().currentPageId;
    editor.createShape(rect('rect-a', 'a1'));

    const secondPageId = createPage('Page 2');
    editor.createShape(rect('rect-b', 'a1'));
    undo();
    expect(editor.getShape('rect-b')).toBeUndefined();

    setCurrentPage(firstPageId);
    // Page 1's own history is untouched by what happened on page 2.
    expect(editor.getShape('rect-a')).toBeDefined();
    undo();
    expect(editor.getShape('rect-a')).toBeUndefined();
    redo();
    expect(editor.getShape('rect-a')).toBeDefined();

    setCurrentPage(secondPageId);
    redo();
    expect(editor.getShape('rect-b')).toBeDefined();
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

  it('drops the deleted page\'s comment threads', () => {
    const firstPageId = useDocumentStore.getState().currentPageId;
    const secondPageId = createPage('Page 2');
    const author = { name: 'A', color: '#000000' };
    const kept = addComment({
      pageId: firstPageId,
      x: 0,
      y: 0,
      text: 'stays',
      author,
    });
    const doomed = addComment({
      pageId: secondPageId,
      x: 0,
      y: 0,
      text: 'goes',
      author,
    });
    addCommentReply(doomed, 'also goes', author);

    setCurrentPage(firstPageId);
    deletePage(secondPageId);

    // Comments live on the board document, so nothing else would ever drop them.
    expect(Object.keys(useCommentsStore.getState().messages)).toEqual([kept]);
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

describe('duplicatePage', () => {
  it('copies the shapes onto a new page placed right after the source', async () => {
    const firstPageId = useDocumentStore.getState().currentPageId;
    editor.createShape(rect('rect-a', 'a1'));
    editor.createShape(rect('rect-b', 'a2'));

    const copyId = await duplicatePage(firstPageId);

    expect(copyId).not.toBe('');
    expect(useDocumentStore.getState().currentPageId).toBe(copyId);
    expect(useDocumentStore.getState().doc.pageOrder).toEqual([
      firstPageId,
      copyId,
    ]);
    expect(useDocumentStore.getState().doc.pages[copyId]?.name).toBe(
      'Page 1 Copy',
    );

    const copied = shapeStore.sorted.get();
    expect(copied).toHaveLength(2);
    // Fresh ids: the copy is an independent page, not an alias of the source.
    expect(copied.map((shape) => shape.id)).not.toContain('rect-a');
    expect(copied.map((shape) => shape.type)).toEqual([
      'rectangle',
      'rectangle',
    ]);

    setCurrentPage(firstPageId);
    expect(shapeStore.sorted.get().map((shape) => shape.id)).toEqual(
      ['rect-a', 'rect-b'],
    );
  });

  it('leaves the source page untouched when the copy is edited', async () => {
    const firstPageId = useDocumentStore.getState().currentPageId;
    editor.createShape(rect('rect-a', 'a1'));

    await duplicatePage(firstPageId);
    const copyShapeId = shapeStore.sorted.get()[0]!.id;
    editor.updateShape(copyShapeId, { x: 999 });

    setCurrentPage(firstPageId);
    expect(editor.getShape('rect-a')?.x).toBe(0);
  });

  it('remaps parents and bindings onto the copies', async () => {
    const firstPageId = useDocumentStore.getState().currentPageId;
    editor.createShape(group('group-a'));
    editor.createShape({ ...rect('rect-a', 'a1'), parentId: 'group-a' });
    editor.createShape(
      arrow('arrow-a', {
        start: { shapeId: 'rect-a', anchor: { x: 0.5, y: 0.5 } },
      }),
    );

    await duplicatePage(firstPageId);

    const copied = shapeStore.sorted.get();
    const copiedGroup = copied.find((shape) => shape.type === 'group')!;
    const copiedRect = copied.find((shape) => shape.type === 'rectangle')!;
    const copiedArrow = copied.find((shape) => shape.type === 'arrow')!;

    expect(copiedRect.parentId).toBe(copiedGroup.id);
    expect(copiedRect.parentId).not.toBe('group-a');
    expect((copiedArrow as ArrowShape).props.bindings?.start?.shapeId).toBe(
      copiedRect.id,
    );
  });

  it('mirrors the source camera and increments a name that is already taken', async () => {
    const firstPageId = useDocumentStore.getState().currentPageId;
    useCameraStore.getState().setCamera({ x: 12, y: 34, z: 0.5 });

    const firstCopy = await duplicatePage(firstPageId);
    expect(useCameraStore.getState().camera).toEqual({ x: 12, y: 34, z: 0.5 });

    setCurrentPage(firstPageId);
    const secondCopy = await duplicatePage(firstPageId);
    expect(useDocumentStore.getState().doc.pages[firstCopy]?.name).toBe(
      'Page 1 Copy',
    );
    expect(useDocumentStore.getState().doc.pages[secondCopy]?.name).toBe(
      'Page 1 Copy 1',
    );
  });

  it('ignores an unknown page id', async () => {
    expect(await duplicatePage('page-does-not-exist')).toBe('');
    expect(useDocumentStore.getState().doc.pageOrder).toHaveLength(1);
  });
});

describe('moveShapesToPage', () => {
  it('moves the shape to the target page keeping its id and position', () => {
    const firstPageId = useDocumentStore.getState().currentPageId;
    const secondPageId = createPage('Page 2');
    setCurrentPage(firstPageId);
    editor.createShape({ ...rect('rect-a', 'a1'), x: 120, y: -40 });

    expect(moveShapesToPage(['rect-a'], secondPageId)).toEqual(['rect-a']);
    expect(editor.getShape('rect-a')).toBeUndefined();

    setCurrentPage(secondPageId);
    expect(editor.getShape('rect-a')).toMatchObject({ x: 120, y: -40 });
  });

  it('carries descendants along and re-roots one whose parent stays behind', () => {
    const firstPageId = useDocumentStore.getState().currentPageId;
    const secondPageId = createPage('Page 2');
    setCurrentPage(firstPageId);
    editor.createShape(group('group-a'));
    editor.createShape({ ...rect('rect-a', 'a1'), parentId: 'group-a' });
    editor.createShape({ ...rect('rect-b', 'a2'), parentId: 'group-a' });

    // The whole group travels: its children come with it, and none is stranded.
    moveShapesToPage(['group-a'], secondPageId);
    expect(shapeStore.sorted.get()).toEqual([]);

    setCurrentPage(secondPageId);
    expect(editor.getShape('rect-a')?.parentId).toBe('group-a');
    expect(editor.getShape('rect-b')?.parentId).toBe('group-a');

    // A lone child moving away cannot keep a parent on the other page.
    const thirdPageId = createPage('Page 3');
    setCurrentPage(secondPageId);
    moveShapesToPage(['rect-a'], thirdPageId);
    setCurrentPage(thirdPageId);
    expect(editor.getShape('rect-a')?.parentId).toBeNull();
  });

  it('dissolves a group the move leaves with one child', () => {
    const firstPageId = useDocumentStore.getState().currentPageId;
    const secondPageId = createPage('Page 2');
    setCurrentPage(firstPageId);
    editor.createShape(group('group-a'));
    editor.createShape({ ...rect('rect-a', 'a1'), parentId: 'group-a' });
    editor.createShape({ ...rect('rect-b', 'a2'), parentId: 'group-a' });

    // The cleanup runs inside the move's own transaction, where `getShapes()`
    // has not yet seen the delete it is reacting to.
    moveShapesToPage(['rect-a'], secondPageId);

    expect(editor.getShape('group-a')).toBeUndefined();
    expect(editor.getShape('rect-b')?.parentId).toBeNull();
  });

  it('refuses a no-op, an unknown page, and an empty selection', () => {
    const firstPageId = useDocumentStore.getState().currentPageId;
    editor.createShape(rect('rect-a', 'a1'));

    expect(moveShapesToPage(['rect-a'], firstPageId)).toEqual([]);
    expect(moveShapesToPage(['rect-a'], 'page-does-not-exist')).toEqual([]);
    expect(moveShapesToPage([], createPage('Page 2'))).toEqual([]);
    setCurrentPage(firstPageId);
    expect(editor.getShape('rect-a')).toBeDefined();
  });

  it('undoes both halves, leaving no copy behind on the target page', () => {
    const firstPageId = useDocumentStore.getState().currentPageId;
    const secondPageId = createPage('Page 2');
    setCurrentPage(firstPageId);
    editor.createShape(rect('rect-a', 'a1'));

    moveShapesToPage(['rect-a'], secondPageId);
    undo();

    expect(editor.getShape('rect-a')).toBeDefined();
    setCurrentPage(secondPageId);
    expect(editor.getShape('rect-a')).toBeUndefined();
  });

  it('does not let the target page undo a move it did not make', () => {
    const firstPageId = useDocumentStore.getState().currentPageId;
    const secondPageId = createPage('Page 2');
    editor.createShape(rect('rect-native', 'a1'));
    setCurrentPage(firstPageId);
    editor.createShape(rect('rect-a', 'a1'));

    moveShapesToPage(['rect-a'], secondPageId);

    // Page 2's own history still points at its own last edit, not the arrival.
    setCurrentPage(secondPageId);
    expect(editor.getShape('rect-a')).toBeDefined();
    undo();
    expect(editor.getShape('rect-a')).toBeDefined();
    expect(editor.getShape('rect-native')).toBeUndefined();
  });

  it('keeps the source page history usable for later edits', () => {
    const firstPageId = useDocumentStore.getState().currentPageId;
    const secondPageId = createPage('Page 2');
    setCurrentPage(firstPageId);
    editor.createShape(rect('rect-a', 'a1'));
    moveShapesToPage(['rect-a'], secondPageId);

    editor.createShape(rect('rect-later', 'a2'));
    undo();
    expect(editor.getShape('rect-later')).toBeUndefined();
    // The move is the step before, still intact underneath.
    undo();
    expect(editor.getShape('rect-a')).toBeDefined();
  });
});

describe('document store snapshot', () => {
  it('applies an index-unchanged update incrementally, preserving order and untouched identities', () => {
    editor.createShape(rect('a', 'a1'));
    editor.createShape(rect('b', 'a2'));
    editor.createShape(rect('c', 'a3'));
    const before = shapeStore.sorted.get();
    expect(before.map((s) => s.id)).toEqual(['a', 'b', 'c']);

    // Moving a shape changes x/y but not its z-`index`: the incremental branch
    // must swap only that entry and keep the rest (order + object identity).
    editor.updateShape('b', { x: 999 });
    const after = shapeStore.sorted.get();

    expect(after).not.toBe(before); // fresh array so subscribers re-render
    expect(after.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(after.find((s) => s.id === 'b')!.x).toBe(999);
    expect(after.find((s) => s.id === 'a')).toBe(
      before.find((s) => s.id === 'a'),
    );
    expect(after.find((s) => s.id === 'c')).toBe(
      before.find((s) => s.id === 'c'),
    );
  });

  it('re-sorts when a shape index changes', () => {
    editor.createShape(rect('a', 'a1'));
    editor.createShape(rect('b', 'a2'));
    expect(ids()).toEqual(['a', 'b']);

    editor.updateShape('a', { index: 'a3' }); // move a after b
    expect(ids()).toEqual(['b', 'a']);
  });

  it('keeps the z-order a full sort would give across mixed batches', () => {
    // Deterministic LCG: a failure replays the same sequence.
    let seed = 7;
    const rand = (n: number) => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed % n;
    };
    // Few distinct indexes, so equal indexes fall back to the id tiebreak.
    const index = () => `a${rand(12).toString(36)}`;
    const live = new Set<string>();
    let next = 0;
    for (let step = 0; step < 300; step++) {
      // Most batches are small and splice; some exceed the splice budget.
      const size = rand(10) === 0 ? 40 : 1 + rand(4);
      editor.transact(() => {
        for (let k = 0; k < size; k++) {
          const pool = [...live];
          const op = pool.length === 0 ? 0 : rand(4);
          const id = pool[rand(pool.length)]!;
          if (op === 0) {
            const created = `s${next++}`;
            editor.createShape(rect(created, index()));
            live.add(created);
          } else if (op === 1) {
            editor.deleteShapes([id]);
            live.delete(id);
          } else if (op === 2) editor.updateShape(id, { index: index() });
          else editor.updateShape(id, { x: rand(100) });
        }
      });
      const published = shapeStore.sorted.get();
      expect(published.map((s) => s.id)).toEqual(
        editor.getShapes().slice().sort(compareIndex).map((s) => s.id),
      );
      expect(published.map((s) => s.id).sort()).toEqual([...live].sort());
      for (const s of published) expect(s).toBe(editor.getShape(s.id));
    }
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

describe('frame children in the spatial index', () => {
  // The Canvas culls a frame's descendants against the same broad-phase id set
  // it uses for top-level shapes, instead of mounting the whole subtree of every
  // frame that happens to intersect the viewport. That is only sound because a
  // child is indexed by its own *world* bounds — if children were indexed
  // relative to their frame, or skipped because they render inside a clip, an
  // on-screen child would be culled and the frame would come up empty.
  const frame = (
    id: string,
    index: string,
    x: number,
    y: number,
  ): FrameShape => ({
    id,
    type: 'frame',
    x,
    y,
    rotation: 0,
    index,
    props: { w: 1000, h: 1000, name: 'Frame' },
  });

  it('indexes a frame child at its world position, not its frame-relative one', () => {
    editor.createShape(frame('frame-a', 'a1', 0, 0));
    editor.createShape({
      ...rect('near', 'a2'),
      x: 100,
      y: 100,
      parentId: 'frame-a',
    });
    editor.createShape({
      ...rect('far', 'a3'),
      x: 90000,
      y: 90000,
      parentId: 'frame-a',
    });

    // A region over the frame's top-left finds the frame and the child sitting
    // there — the child is reachable by the same search the Canvas culls with.
    expect(new Set(spatialIndex.search(box(95, 95, 115, 115)))).toEqual(
      new Set(['frame-a', 'near']),
    );
    // The distant child is not in it, so culling it is correct rather than a
    // dropped shape.
    expect(spatialIndex.search(box(95, 95, 115, 115))).not.toContain('far');
    expect(spatialIndex.search(box(89995, 89995, 90015, 90015))).toEqual([
      'far',
    ]);
  });

  it('follows a child that moves out of the searched region', () => {
    editor.createShape(frame('frame-a', 'a1', 0, 0));
    editor.createShape({
      ...rect('child', 'a2'),
      x: 100,
      y: 100,
      parentId: 'frame-a',
    });
    expect(spatialIndex.search(box(95, 95, 115, 115))).toContain('child');

    editor.updateShape('child', { x: 90000, y: 90000 });
    expect(spatialIndex.search(box(95, 95, 115, 115))).not.toContain('child');
    expect(spatialIndex.search(box(89995, 89995, 90015, 90015))).toContain(
      'child',
    );
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

  it('sends only the new points on a live write, not the unchanged props', () => {
    // Bytes emitted to peers for a stroke written the way the draw tool does:
    // the growing point array plus `isComplete: false` on every write.
    const wireBytes = (id: string, extra: Record<string, unknown>): number => {
      const page = residentPageDoc(useDocumentStore.getState().currentPageId)!;
      editor.createShape(draw(id, []));
      let bytes = 0;
      const count = (update: Uint8Array) => (bytes += update.byteLength);
      page.doc.on('updateV2', count);
      const points: DrawPoint[] = [];
      for (const p of stroke(300)) {
        points.push(p);
        if (points.length % 5 === 0) {
          editor.updateShape(id, { props: { points: [...points], ...extra } });
        }
      }
      page.doc.off('updateV2', count);
      return bytes;
    };

    const pointsOnly = wireBytes('points-only', {});
    const liveWrites = wireBytes('live', { isComplete: false });
    // Rewriting props every write measured ~5x the points-only cost.
    expect(liveWrites / pointsOnly).toBeLessThan(1.1);
  });

  it('emits nothing for a patch that changes nothing', () => {
    const page = residentPageDoc(useDocumentStore.getState().currentPageId)!;
    editor.createShape(rect('r', 'a1'));
    let updates = 0;
    const count = () => (updates += 1);
    page.doc.on('updateV2', count);
    editor.updateShape('r', { x: 0, y: 0, props: { w: 10, color: '#000000' } });
    page.doc.off('updateV2', count);
    expect(updates).toBe(0);
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
    const published = shapeStore.sorted.get();

    for (let n = 3; n <= 12; n++) {
      editor.updateShape('live', { props: { points: stroke(n) } });
      // The write is what peers watch, so it must land on every frame...
      expect(drawnPoints('live')).toHaveLength(n);
      // ...while locally the active-stroke layer is already drawing it, so
      // rebuilding the page's derived state to say so would be pure cost.
      expect(shapeStore.sorted.get()).toBe(published);
    }
  });

  it('publishes a live highlighter, whose underlay the scene paints', () => {
    const marker = draw('live', stroke(2));
    editor.createShape({
      ...marker,
      props: { ...marker.props, inkKind: 'highlight' },
    } as Shape);
    beginLiveStroke('live');

    editor.updateShape('live', { props: { points: stroke(9) } });
    const shape = shapeStore.sorted.get().find((s) => s.id === 'live');
    expect(shape?.type === 'draw' && shape.props.points).toHaveLength(9);
  });

  it('still publishes when anything else changes', () => {
    editor.createShape(draw('live', stroke(2)));
    beginLiveStroke('live');
    const published = shapeStore.sorted.get();

    // A peer's edit, an arrow rerouting, an eraser — none of it may be held up
    // behind somebody's pen.
    editor.createShape(rect('other', 'a2'));
    expect(shapeStore.sorted.get()).not.toBe(published);
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

    const shape = shapeStore.sorted.get().find((s) => s.id === 'live');
    expect(shape?.type === 'draw' && shape.props.points).toHaveLength(41);
  });
});

describe('edits arriving from outside this client', () => {
  // Frames the paced publish is queued against. Node has no rAF, and without
  // one the store publishes immediately — which is the fallback, not the
  // behaviour under test.
  let frames: FrameRequestCallback[] = [];
  beforeEach(() => {
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => {
      frames[handle - 1] = () => {};
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const paint = () => {
    const due = frames;
    frames = [];
    for (const cb of due) cb(0);
  };

  /** Apply `edit` to the current page the way a peer's update would arrive. */
  const fromPeer = (edit: (shapes: Y.Map<unknown>) => void) => {
    const page = residentPageDoc(useDocumentStore.getState().currentPageId)!;
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(page.doc));
    peer.transact(() => edit(peer.getMap('shapes')));
    // A plain object origin stands in for the provider: what the store keys on
    // is that the origin is not one of its own string constants.
    Y.applyUpdate(
      page.doc,
      Y.encodeStateAsUpdate(peer, Y.encodeStateVector(page.doc)),
      {},
    );
    peer.destroy();
  };

  it('is readable at once but publishes at most once a frame', () => {
    // Someone else's pen writes a frame of their stroke per animation frame of
    // *their* machine, which is not this one's. Ten arrive here between paints.
    for (let n = 0; n < 10; n++) {
      const published = shapeStore.sorted.get();
      fromPeer((shapes) => {
        const m = new Y.Map<unknown>();
        m.set(SHAPE_BASE_KEY, [`peer-${n}`, 'rectangle', n, 0, 0, `a${n}`]);
        m.set('props', {
          w: 10,
          h: 10,
          color: '#000000',
          fillStyle: 'none',
          dash: 'solid',
          size: 2,
        });
        shapes.set(`peer-${n}`, m);
      });
      // Hit-testing, the spatial index and `getShape` are never behind the
      // document — only the React publish waits.
      expect(editor.getShape(`peer-${n}`)?.x).toBe(n);
      expect(spatialIndex.search(box(-1, -1, 100, 100))).toContain(`peer-${n}`);
      expect(shapeStore.sorted.get()).toBe(published);
    }

    paint();
    expect(ids()).toHaveLength(10);
  });

  it('does not delay a local edit, or leave one queued behind it', () => {
    fromPeer((shapes) => {
      const m = new Y.Map<unknown>();
      m.set(SHAPE_BASE_KEY, ['peer', 'rectangle', 0, 0, 0, 'a1']);
      m.set('props', {
        w: 10,
        h: 10,
        color: '#000000',
        fillStyle: 'none',
        dash: 'solid',
        size: 2,
      });
      shapes.set('peer', m);
    });

    // The local edit publishes now, and carries the peer's shape with it —
    // both are read off the same live caches.
    editor.createShape(rect('mine', 'a2'));
    expect(ids()).toEqual(['peer', 'mine']);

    // ...so the frame the peer's update queued has nothing left to say.
    const published = shapeStore.sorted.get();
    paint();
    expect(shapeStore.sorted.get()).toBe(published);
  });

  it('publishes an undo immediately', () => {
    editor.createShape(rect('a', 'a1'));
    undo();
    // Yjs tags an undo with the UndoManager itself, which is an object like a
    // provider is — but it is this client's own hand, and waits for nothing.
    expect(ids()).toEqual([]);
  });
});

describe('deleted shapes fade out', () => {
  const ghostIds = () =>
    useVanishStore.getState().ghosts.map((g) => g.shape.id);

  afterEach(() => {
    clearVanishing();
    useEraserStore.getState().clear();
    useEraserCutStore.getState().clear();
    useHiddenStore.getState().showAll();
  });

  it('keeps a snapshot of the deleted shape until the fade ends', () => {
    vi.useFakeTimers();
    try {
      editor.createShape(rect('a', 'a1'));
      editor.deleteShapes(['a']);

      // Gone from the document, still on screen for the length of the fade.
      expect(ids()).toEqual([]);
      expect(ghostIds()).toEqual(['a']);
      expect(useVanishStore.getState().ghosts[0]?.opacity).toBe(1);

      vi.advanceTimersByTime(VANISH_MS);
      expect(ghostIds()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fades from the dimmed state the eraser left the shape in', () => {
    editor.createShape(rect('a', 'a1'));
    useEraserStore.getState().set(['a']);
    editor.deleteShapes(['a']);

    // The shape has been rendering at ERASE_DIM since the eraser touched it;
    // starting the fade at full opacity would flash it back to solid.
    expect(useVanishStore.getState().ghosts[0]?.opacity).toBe(ERASE_DIM);
  });

  it('does not ghost shapes that were not on screen', () => {
    editor.createShape(rect('hidden', 'a1'));
    editor.createShape(rect('cut', 'a2'));
    useHiddenStore.getState().hide(['hidden']);
    // Mid-cut: the fragments have been standing in for the original all stroke.
    useEraserCutStore.getState().set({ cut: [] });

    editor.deleteShapes(['hidden', 'cut']);
    expect(ghostIds()).toEqual([]);
  });

  it('re-deleting a shape restarts one fade rather than stacking two', () => {
    editor.createShape(rect('a', 'a1'));
    editor.deleteShapes(['a']);
    const first = useVanishStore.getState().ghosts[0]?.key;
    // Restored (by an undo, or by a peer) and deleted again while the first
    // fade is still running.
    editor.createShape(rect('a', 'a1'));
    editor.deleteShapes(['a']);

    const ghosts = useVanishStore.getState().ghosts;
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0]?.key).not.toBe(first);
  });

  it('skips the fade for a mass delete', () => {
    const many = Array.from({ length: 201 }, (_, i) => `s${i}`);
    editor.transact(() => {
      for (const [i, id] of many.entries())
        editor.createShape(rect(id, `a${i}`));
    });
    editor.deleteShapes(many);

    expect(ids()).toEqual([]);
    expect(ghostIds()).toEqual([]);
  });

  it('drops ghosts when the page they belong to leaves the screen', () => {
    editor.createShape(rect('a', 'a1'));
    editor.deleteShapes(['a']);
    createPage();

    expect(ghostIds()).toEqual([]);
  });
});

describe('reads inside a transaction', () => {
  // Pinned, not endorsed: the cache only catches up when the outermost
  // transaction commits, and `getShape` reads through it while `getShapes`
  // does not. `place-pdf.ts` works around exactly this.
  it('sees a new shape through getShape but not getShapes until commit', () => {
    editor.transact(() => {
      editor.createShape(rect('mid-transaction', 'a1'));
      expect(editor.getShape('mid-transaction')?.id).toBe('mid-transaction');
      expect(editor.getShapes().map((s) => s.id)).not.toContain(
        'mid-transaction',
      );
    });
    expect(editor.getShapes().map((s) => s.id)).toContain('mid-transaction');
  });
});
