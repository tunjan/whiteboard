import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { create } from 'zustand';
import { genId, type Page, type Shape, type WhiteboardDocument } from '@whiteboard/shared';
import type { Editor, ShapePatch } from './editor';
import { generateKeyBetween } from './order';
import { shapeRegistry } from './shapes/shape-registry';
import { SpatialIndex } from './spatial-index';
import { useCameraStore } from './use-camera-store';
import { useSelectionStore } from './use-selection-store';
import { useConnectionStore } from '@/collab/use-connection-store';
import { setActiveAwareness, setLocalPage } from '@/collab/presence';

// page-default's shapes live at the doc root map `shapes` (unchanged from Pass 1),
// which keeps the Yjs structure idempotent across IndexedDB + server sync. Every
// other page stores its shapes in its own top-level map `shapes:<pageId>` —
// top-level named maps converge across clients with no migration. Page metadata
// (name + fractional order index) lives in the `pages` registry map.
const DEFAULT_PAGE_ID = 'page-default';
const DEFAULT_PAGE_NAME = 'Page 1';

/** Origin tag for this client's own mutations — only these are undoable. */
export const LOCAL_ORIGIN = 'local-user';

/** Room name for a board's Yjs content (IndexedDB + Hocuspocus). */
export function boardRoom(boardId: string): string {
  return `whiteboard:board:${boardId}`;
}

function collabUrl(): string {
  // Dev: the collab server runs on :3001. Use the page's own hostname (not a
  // literal "localhost") so a phone/iPad hitting the dev box over the LAN
  // connects to the right machine instead of to itself.
  if (import.meta.env.DEV) return `ws://${location.hostname}:3001`;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}`;
}

export const spatialIndex = new SpatialIndex();

export function compareIndex(a: Shape, b: Shape): number {
  return a.index < b.index ? -1 : a.index > b.index ? 1 : 0;
}

// --- Pages registry helpers ---

type YPageMeta = Y.Map<unknown>;

interface PageMeta {
  id: string;
  name: string;
  index: string;
}

/** Name of the Yjs map holding a page's shapes. page-default lives at the root. */
function shapesMapName(pageId: string): string {
  return pageId === DEFAULT_PAGE_ID ? 'shapes' : `shapes:${pageId}`;
}

function getShapesMap(doc: Y.Doc, pageId: string): Y.Map<YShape> {
  return doc.getMap(shapesMapName(pageId)) as Y.Map<YShape>;
}

/** Read the page registry, sorted by fractional order index. */
function readPages(pages: Y.Map<YPageMeta>): PageMeta[] {
  const out: PageMeta[] = [];
  for (const [id, m] of pages) {
    out.push({
      id,
      name: (m.get('name') as string) ?? 'Page',
      index: (m.get('index') as string) ?? 'a0',
    });
  }
  out.sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0));
  return out;
}

// --- Yjs <-> plain shape conversion ---

type YShape = Y.Map<unknown>;

function shapeToY(shape: Shape): YShape {
  const m = new Y.Map<unknown>();
  m.set('id', shape.id);
  m.set('type', shape.type);
  m.set('x', shape.x);
  m.set('y', shape.y);
  m.set('rotation', shape.rotation);
  m.set('index', shape.index);
  if (shape.parentId !== undefined) m.set('parentId', shape.parentId);
  if (shape.locked !== undefined) m.set('locked', shape.locked);
  if (shape.hidden !== undefined) m.set('hidden', shape.hidden);
  if (shape.opacity !== undefined) m.set('opacity', shape.opacity);
  m.set('props', shape.props);
  return m;
}

function yToShape(m: YShape): Shape {
  return {
    id: m.get('id'),
    type: m.get('type'),
    x: m.get('x'),
    y: m.get('y'),
    rotation: m.get('rotation'),
    index: m.get('index'),
    parentId: m.get('parentId'),
    locked: m.get('locked'),
    hidden: m.get('hidden'),
    opacity: m.get('opacity'),
    props: m.get('props'),
  } as Shape;
}

function applyPatchToY(m: YShape, patch: ShapePatch): void {
  if (patch.x !== undefined) m.set('x', patch.x);
  if (patch.y !== undefined) m.set('y', patch.y);
  if (patch.rotation !== undefined) m.set('rotation', patch.rotation);
  if (patch.index !== undefined) m.set('index', patch.index);
  if (patch.parentId !== undefined) m.set('parentId', patch.parentId);
  if (patch.locked !== undefined) m.set('locked', patch.locked);
  if (patch.hidden !== undefined) m.set('hidden', patch.hidden);
  if (patch.opacity !== undefined) m.set('opacity', patch.opacity);
  if (patch.props) {
    m.set('props', { ...(m.get('props') as object), ...patch.props });
  }
}

// --- Current board session ---

interface Session {
  boardId: string;
  doc: Y.Doc;
  /** Page registry: pageId -> { id, name, index }. */
  pages: Y.Map<YPageMeta>;
  /** Shapes map for the active page (root `shapes` for page-default). */
  currentShapes: Y.Map<YShape>;
  currentPageId: string;
  undo: Y.UndoManager;
  /** Deep observer bound to `currentShapes`; swapped on page switch. */
  shapesObserver: (events: Y.YEvent<Y.AbstractType<unknown>>[]) => void;
  pagesObserver: () => void;
  persistence: IndexeddbPersistence | null;
  provider: HocuspocusProvider | null;
  cleanup: () => void;
}

let session: Session | null = null;

const shapeCache = new Map<string, Shape>();

interface DocStore {
  boardId: string;
  doc: WhiteboardDocument;
  currentPageId: string;
}

const EMPTY_SNAPSHOT: WhiteboardDocument = { pages: {}, pageOrder: [] };

export const useDocumentStore = create<DocStore>(() => ({
  boardId: '',
  doc: EMPTY_SNAPSHOT,
  currentPageId: DEFAULT_PAGE_ID,
}));

function rebuildSnapshot(): void {
  if (!session) return;
  const shapes: Record<string, Shape> = {};
  for (const [id, shape] of shapeCache) shapes[id] = shape;

  const metas = readPages(session.pages);
  const pages: Record<string, Page> = {};
  for (const meta of metas) {
    // Only the current page carries live shapes; others render nothing.
    pages[meta.id] = {
      id: meta.id,
      name: meta.name,
      shapes: meta.id === session.currentPageId ? shapes : {},
    };
  }
  // Before the registry is seeded (legacy/new board), still present the current
  // page so the canvas + page menu have something to render.
  if (!pages[session.currentPageId]) {
    pages[session.currentPageId] = {
      id: session.currentPageId,
      name: DEFAULT_PAGE_NAME,
      shapes,
    };
  }
  const pageOrder = Object.keys(pages).sort((a, b) => {
    const ia = metas.find((m) => m.id === a)?.index ?? '';
    const ib = metas.find((m) => m.id === b)?.index ?? '';
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  });

  useDocumentStore.setState({
    doc: { pages, pageOrder },
    currentPageId: session.currentPageId,
  });
}

function applyAffected(ids: Set<string>): void {
  if (!session) return;
  for (const id of ids) {
    const m = session.currentShapes.get(id);
    if (m) {
      const shape = yToShape(m);
      shapeCache.set(id, shape);
      const util = shapeRegistry.getFor(shape);
      // Groups have no geometry of their own — keep them out of the index.
      if (util && shape.type !== 'group') spatialIndex.insert(id, util.getBounds(shape));
    } else {
      shapeCache.delete(id);
      spatialIndex.remove(id);
    }
  }
  rebuildSnapshot();
}

function fullResync(): void {
  if (!session) return;
  shapeCache.clear();
  spatialIndex.clear();
  for (const [id, m] of session.currentShapes) {
    const shape = yToShape(m);
    shapeCache.set(id, shape);
    const util = shapeRegistry.getFor(shape);
    if (util) spatialIndex.insert(id, util.getBounds(shape));
  }
  rebuildSnapshot();
}

function makeShapesObserver(): (
  events: Y.YEvent<Y.AbstractType<unknown>>[],
) => void {
  return (events) => {
    const affected = new Set<string>();
    for (const e of events) {
      if (e.target === session?.currentShapes) {
        for (const key of e.keys.keys()) affected.add(key);
      } else if (typeof e.path[0] === 'string') {
        affected.add(e.path[0]);
      }
    }
    applyAffected(affected);
  };
}

/** Idempotently seed page-default. Only runs when the registry is truly empty. */
function maybeSeedDefaultPage(): void {
  if (!session || session.pages.size > 0) return;
  session.doc.transact(() => {
    const m = new Y.Map<unknown>();
    m.set('id', DEFAULT_PAGE_ID);
    m.set('name', DEFAULT_PAGE_NAME);
    m.set('index', generateKeyBetween(null, null));
    session!.pages.set(DEFAULT_PAGE_ID, m);
  });
}

/**
 * Load (or switch to) a board. Attaches local persistence and (optionally) the
 * Hocuspocus collaboration provider to a fresh Yjs doc. Returns a disposer.
 */
export function loadBoard(
  boardId: string,
  opts: { persist?: boolean; collab?: boolean } = {},
): () => void {
  session?.cleanup();
  session = null;
  shapeCache.clear();
  spatialIndex.clear();
  useDocumentStore.setState({
    boardId,
    doc: EMPTY_SNAPSHOT,
    currentPageId: DEFAULT_PAGE_ID,
  });

  const doc = new Y.Doc();
  const pages = doc.getMap('pages') as Y.Map<YPageMeta>;
  const currentShapes = getShapesMap(doc, DEFAULT_PAGE_ID);
  const undo = new Y.UndoManager(currentShapes, {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
  });

  const shapesObserver = makeShapesObserver();
  currentShapes.observeDeep(shapesObserver);

  const pagesObserver = () => {
    if (!session) return;
    // A peer deleted the page we're on — fall back to the first remaining page.
    if (session.pages.size > 0 && !session.pages.has(session.currentPageId)) {
      const first = readPages(session.pages)[0];
      if (first) {
        switchToPageInternal(first.id);
        return;
      }
    }
    rebuildSnapshot();
  };
  pages.observe(pagesObserver);

  const persistence = opts.persist
    ? new IndexeddbPersistence(boardRoom(boardId), doc)
    : null;

  let provider: HocuspocusProvider | null = null;
  if (opts.collab) {
    provider = new HocuspocusProvider({
      url: collabUrl(),
      name: boardId,
      document: doc,
    });
    provider.on('status', (event: { status: string }) => {
      useConnectionStore.getState().setStatus(event.status);
    });
    setActiveAwareness(provider.awareness ?? null);
  } else {
    useConnectionStore.getState().setStatus('disconnected');
  }

  session = {
    boardId,
    doc,
    pages,
    currentShapes,
    currentPageId: DEFAULT_PAGE_ID,
    undo,
    shapesObserver,
    pagesObserver,
    persistence,
    provider,
    cleanup: () => {
      setActiveAwareness(null);
      session?.currentShapes.unobserveDeep(session.shapesObserver);
      pages.unobserve(pagesObserver);
      undo.destroy();
      provider?.destroy();
      persistence?.destroy();
      doc.destroy();
    },
  };

  useCameraStore.getState().switchTo(boardId, DEFAULT_PAGE_ID);
  setLocalPage(DEFAULT_PAGE_ID);

  // Seed page-default once the board's existing state is known. We only seed
  // when the registry is still empty after sync, so a deliberately deleted
  // page-default is never resurrected (other pages keep the registry non-empty).
  maybeSeedDefaultPage();
  persistence?.on('synced', maybeSeedDefaultPage);
  provider?.on('synced', maybeSeedDefaultPage);

  fullResync();

  let disposed = false;
  return () => {
    if (disposed || session?.doc !== doc) return;
    disposed = true;
    session.cleanup();
    session = null;
  };
}

export function undo(): void {
  session?.undo.undo();
}
export function redo(): void {
  session?.undo.redo();
}

// --- Pages API ---

/** Switch the active page (re-scopes observer, undo, cache, and camera). */
function switchToPageInternal(pageId: string): void {
  if (!session) return;
  session.currentShapes.unobserveDeep(session.shapesObserver);
  session.undo.destroy();

  const map = getShapesMap(session.doc, pageId);
  session.currentShapes = map;
  session.currentPageId = pageId;
  session.shapesObserver = makeShapesObserver();
  map.observeDeep(session.shapesObserver);
  session.undo = new Y.UndoManager(map, {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
  });

  useSelectionStore.getState().clear();
  useCameraStore.getState().switchTo(session.boardId, pageId);
  setLocalPage(pageId);
  fullResync();
}

export function setCurrentPage(pageId: string): void {
  if (!session || session.currentPageId === pageId) return;
  switchToPageInternal(pageId);
}

/** Create a new page after the current one and switch to it. Returns its id. */
export function createPage(name?: string): string {
  if (!session) return '';
  const id = genId();
  const metas = readPages(session.pages);
  const at = metas.findIndex((m) => m.id === session!.currentPageId);
  const before =
    at >= 0 ? (metas[at]?.index ?? null) : (metas.at(-1)?.index ?? null);
  const after = at >= 0 ? (metas[at + 1]?.index ?? null) : null;
  const index = generateKeyBetween(before, after);
  const pageName = name?.trim() || `Page ${metas.length + 1}`;
  session.doc.transact(() => {
    const m = new Y.Map<unknown>();
    m.set('id', id);
    m.set('name', pageName);
    m.set('index', index);
    session!.pages.set(id, m);
  });
  switchToPageInternal(id);
  return id;
}

export function renamePage(id: string, name: string): void {
  if (!session) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  session.doc.transact(() => {
    const m = session!.pages.get(id);
    if (m) m.set('name', trimmed);
  });
}

export function deletePage(id: string): void {
  if (!session) return;
  const metas = readPages(session.pages);
  if (metas.length <= 1) return; // never delete the last page
  if (session.currentPageId === id) {
    const at = metas.findIndex((m) => m.id === id);
    const neighbor = metas[at + 1] ?? metas[at - 1];
    if (neighbor) switchToPageInternal(neighbor.id);
  }
  session.doc.transact(() => {
    session!.pages.delete(id);
    getShapesMap(session!.doc, id).clear();
  });
}

/** Move a page one slot up or down in the order (conflict-free fractional key). */
export function movePage(id: string, direction: 'up' | 'down'): void {
  if (!session) return;
  const metas = readPages(session.pages);
  const i = metas.findIndex((m) => m.id === id);
  if (i < 0) return;
  const j = direction === 'up' ? i - 1 : i + 1;
  const neighbor = metas[j];
  if (!neighbor) return;
  let before: string | null;
  let after: string | null;
  if (direction === 'up') {
    before = metas[j - 1]?.index ?? null;
    after = neighbor.index;
  } else {
    before = neighbor.index;
    after = metas[j + 1]?.index ?? null;
  }
  const index = generateKeyBetween(before, after);
  session.doc.transact(() => {
    session!.pages.get(id)?.set('index', index);
  });
}

// --- Editor (stable; mutates the current page's Yjs map) ---

function transactLocal(fn: () => void): void {
  session?.doc.transact(fn, LOCAL_ORIGIN);
}

export const editor: Editor = {
  getShape: (id) => {
    const m = session?.currentShapes.get(id);
    return m ? yToShape(m) : undefined;
  },
  getShapes: () => {
    if (!session) return [];
    return [...session.currentShapes.values()].map(yToShape).sort(compareIndex);
  },
  createShape: (shape) =>
    transactLocal(() => session?.currentShapes.set(shape.id, shapeToY(shape))),
  updateShape: (id, patch) =>
    transactLocal(() => {
      const m = session?.currentShapes.get(id);
      if (m) applyPatchToY(m, patch);
    }),
  deleteShapes: (ids) =>
    transactLocal(() => {
      for (const id of ids) session?.currentShapes.delete(id);
    }),
};
