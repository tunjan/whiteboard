import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { create } from 'zustand';
import {
  DEFAULT_MUSIC_PLAYBACK,
  genId,
  type MusicPlaybackState,
  type MusicPlaybackStatus,
  type Page,
  type Shape,
  type WhiteboardDocument,
} from '@whiteboard/shared';
import type { Editor, ShapePatch } from './editor';
import { generateKeyBetween } from './order';
import { shapeRegistry } from './shapes/shape-registry';
import { shapeRotatedBounds } from './shape-bounds';
import { SpatialIndex } from './spatial-index';
import { useCameraStore } from './use-camera-store';
import { useSelectionStore } from './use-selection-store';
import { useConnectionStore } from '@/collab/use-connection-store';
import { setActiveAwareness, setLocalPage } from '@/collab/presence';
import { useMusicPlaybackStore } from '@/music/use-music-playback-store';

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
  if (shape.type === 'text') {
    // Text is a sequence CRDT, not a scalar property. Concurrent insert/delete
    // operations then merge by character identity instead of overwriting the
    // entire string with whichever client wrote last.
    const { text, ...props } = shape.props;
    m.set('props', props);
    m.set('text', new Y.Text(text));
  } else {
    m.set('props', shape.props);
  }
  return m;
}

function yToShape(m: YShape): Shape {
  const type = m.get('type');
  const storedProps = (m.get('props') as Record<string, unknown> | undefined) ?? {};
  const props =
    type === 'text'
      ? {
          ...storedProps,
          text:
            m.get('text') instanceof Y.Text
              ? (m.get('text') as Y.Text).toString()
              : typeof storedProps.text === 'string'
                ? storedProps.text
                : '',
        }
      : storedProps;
  return {
    id: m.get('id'),
    type,
    x: m.get('x'),
    y: m.get('y'),
    rotation: m.get('rotation'),
    index: m.get('index'),
    parentId: m.get('parentId'),
    locked: m.get('locked'),
    hidden: m.get('hidden'),
    opacity: m.get('opacity'),
    props,
  } as Shape;
}

/** Apply the smallest contiguous replacement between two strings to Y.Text. */
function syncYText(text: Y.Text, next: string): void {
  const current = text.toString();
  if (current === next) return;

  let prefix = 0;
  const limit = Math.min(current.length, next.length);
  while (prefix < limit && current[prefix] === next[prefix]) prefix++;

  let suffix = 0;
  while (
    suffix < current.length - prefix &&
    suffix < next.length - prefix &&
    current[current.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix++;
  }

  const remove = current.length - prefix - suffix;
  if (remove > 0) text.delete(prefix, remove);
  const insert = next.slice(prefix, next.length - suffix);
  if (insert) text.insert(prefix, insert);
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
    const nextProps = { ...patch.props };
    if (m.get('type') === 'text' && typeof nextProps.text === 'string') {
      const existing = m.get('text');
      let text: Y.Text;
      if (existing instanceof Y.Text) {
        text = existing;
      } else {
        const legacy = m.get('props') as { text?: unknown } | undefined;
        text = new Y.Text(typeof legacy?.text === 'string' ? legacy.text : '');
        m.set('text', text);
      }
      syncYText(text, nextProps.text);
      delete nextProps.text;
    }
    if (Object.keys(nextProps).length > 0) {
      const current =
        (m.get('props') as Record<string, unknown> | undefined) ?? {};
      const merged = { ...current, ...nextProps };
      // Once a legacy shape has a Y.Text, remove its stale scalar copy.
      if (m.get('type') === 'text' && m.get('text') instanceof Y.Text) {
        delete merged.text;
      }
      m.set('props', merged);
    }
  }
}

// --- Current board session ---

interface Session {
  boardId: string;
  doc: Y.Doc;
  /** Page registry: pageId -> { id, name, index }. */
  pages: Y.Map<YPageMeta>;
  /** Shared playback state for the board's music player. */
  music: Y.Map<unknown>;
  /** Shapes map for the active page (root `shapes` for page-default). */
  currentShapes: Y.Map<YShape>;
  currentPageId: string;
  undo: Y.UndoManager;
  /** Detaches the undo-state listeners; swapped on page switch. */
  unbindUndoState: () => void;
  /** Deep observer bound to `currentShapes`; swapped on page switch. */
  shapesObserver: (events: Y.YEvent<Y.AbstractType<unknown>>[]) => void;
  pagesObserver: () => void;
  musicObserver: () => void;
  persistence: IndexeddbPersistence | null;
  provider: HocuspocusProvider | null;
  cleanup: () => void;
}

let session: Session | null = null;

const shapeCache = new Map<string, Shape>();
// Lazily-built, z-sorted view of `shapeCache` for `editor.getShapes()`. The
// cache stays in sync with `shapeCache` (invalidated wherever it mutates), so
// reads avoid re-deserializing the whole Yjs map and re-sorting on every call —
// tools hit this many times per pointer event. The array is shared; callers
// treat it as read-only (none mutate it in place).
let sortedShapesCache: Shape[] | null = null;

/** Current page's shapes, z-sorted. One shared array for `getShapes()` and the
 *  store snapshot, so consumers never re-sort the document themselves. */
function currentSortedShapes(): Shape[] {
  if (!sortedShapesCache) {
    sortedShapesCache = [...shapeCache.values()].sort(compareIndex);
  }
  return sortedShapesCache;
}

interface DocStore {
  boardId: string;
  doc: WhiteboardDocument;
  /** Current page's shapes, z-sorted. Reference is stable until a shape
   *  mutates, so camera-only renders don't invalidate consumers' memos and no
   *  component re-derives `Object.values(...).sort(...)` per render. */
  shapes: Shape[];
  currentPageId: string;
}

const EMPTY_SNAPSHOT: WhiteboardDocument = { pages: {}, pageOrder: [] };

export const useDocumentStore = create<DocStore>(() => ({
  boardId: '',
  doc: EMPTY_SNAPSHOT,
  shapes: [],
  currentPageId: DEFAULT_PAGE_ID,
}));

/** Reactive availability of undo/redo for toolbar buttons. */
export const useUndoStore = create<{ canUndo: boolean; canRedo: boolean }>(
  () => ({ canUndo: false, canRedo: false }),
);

/** Mirror an UndoManager's stack depth into useUndoStore. Returns a cleanup. */
function bindUndoState(manager: Y.UndoManager): () => void {
  const sync = () =>
    useUndoStore.setState({
      canUndo: manager.undoStack.length > 0,
      canRedo: manager.redoStack.length > 0,
    });
  sync();
  manager.on('stack-item-added', sync);
  manager.on('stack-item-popped', sync);
  manager.on('stack-cleared', sync);
  return () => {
    manager.off('stack-item-added', sync);
    manager.off('stack-item-popped', sync);
    manager.off('stack-cleared', sync);
  };
}

// Cached page skeleton (ids, names, order) with empty shape maps. Rebuilt only
// when the pages registry actually changes — shape-only mutations (draw/drag)
// reuse it instead of re-reading the registry and re-sorting the page order on
// every frame. The current page's live shapes are injected in `rebuildSnapshot`.
let cachedPages: Record<string, Page> = {};
let cachedPageOrder: string[] = [];

/** Recompute the cached page skeleton from the registry. Cheap in the number of
 *  pages; call only when the pages map changes or the active page switches. */
function rebuildPagesCache(): void {
  if (!session) {
    cachedPages = {};
    cachedPageOrder = [];
    return;
  }
  const metas = readPages(session.pages);
  const pages: Record<string, Page> = {};
  for (const meta of metas) {
    pages[meta.id] = { id: meta.id, name: meta.name, shapes: {} };
  }
  // Before the registry is seeded (legacy/new board), still present the current
  // page so the canvas + page menu have something to render.
  if (!pages[session.currentPageId]) {
    pages[session.currentPageId] = {
      id: session.currentPageId,
      name: DEFAULT_PAGE_NAME,
      shapes: {},
    };
  }
  cachedPages = pages;
  // `metas` is already index-sorted; keep that order and append the unseeded
  // fallback page (if any) at the front so it stays deterministic.
  cachedPageOrder = Object.keys(pages).sort((a, b) => {
    const ia = metas.find((m) => m.id === a)?.index ?? '';
    const ib = metas.find((m) => m.id === b)?.index ?? '';
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  });
}

function rebuildSnapshot(): void {
  if (!session) return;
  const shapes: Record<string, Shape> = {};
  for (const [id, shape] of shapeCache) shapes[id] = shape;

  // Reuse the cached skeleton, swapping the live shapes into the current page
  // only. Other pages keep their stable (empty) entries, so page order and
  // metadata identities don't churn on shape mutations.
  const pages: Record<string, Page> = {};
  for (const id in cachedPages) {
    const p = cachedPages[id]!;
    pages[id] =
      id === session.currentPageId
        ? { id: p.id, name: p.name, shapes }
        : p;
  }

  useDocumentStore.setState({
    doc: { pages, pageOrder: cachedPageOrder },
    shapes: currentSortedShapes(),
    currentPageId: session.currentPageId,
  });
}

function readMusicPlayback(): MusicPlaybackState {
  if (!session) return DEFAULT_MUSIC_PLAYBACK;
  const status = asMusicStatus(session.music.get('status'));
  return {
    trackId: asStringOrNull(session.music.get('trackId')),
    status,
    position: asNonNegativeNumber(session.music.get('position'), 0),
    updatedAt: asNonNegativeNumber(session.music.get('updatedAt'), 0),
    version: asNonNegativeNumber(session.music.get('version'), 0),
    requestedBy: asOptionalString(session.music.get('requestedBy')),
  };
}

function publishMusicPlayback(): void {
  useMusicPlaybackStore.getState().setPlayback(readMusicPlayback());
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNonNegativeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function asMusicStatus(value: unknown): MusicPlaybackStatus {
  return value === 'playing' || value === 'paused' || value === 'stopped'
    ? value
    : DEFAULT_MUSIC_PLAYBACK.status;
}

function applyAffected(ids: Set<string>): void {
  if (!session) return;
  // A stroke or drag mutates a shape's props/position but never its z-`index`
  // or the set of shapes, so the sorted order is unchanged. Track whether any
  // affected id was added, removed, or re-indexed; if not, we can build the next
  // sorted array by swapping the changed entries in place (O(N), no re-sort).
  let orderChanged = false;
  const updated = new Map<string, Shape>();
  for (const id of ids) {
    const m = session.currentShapes.get(id);
    if (m) {
      const prev = shapeCache.get(id);
      const shape = yToShape(m);
      shapeCache.set(id, shape);
      const util = shapeRegistry.getFor(shape);
      // Groups have no geometry of their own — keep them out of the index.
      if (util && shape.type !== 'group')
        spatialIndex.insert(id, shapeRotatedBounds(shape));
      if (!prev || prev.index !== shape.index) orderChanged = true;
      else updated.set(id, shape);
    } else {
      shapeCache.delete(id);
      spatialIndex.remove(id);
      orderChanged = true;
    }
  }
  if (orderChanged || !sortedShapesCache) {
    sortedShapesCache = null;
  } else {
    // Same membership and order — replace just the changed shapes by id.
    sortedShapesCache = sortedShapesCache.map((s) => updated.get(s.id) ?? s);
  }
  rebuildSnapshot();
}

function fullResync(): void {
  if (!session) return;
  shapeCache.clear();
  sortedShapesCache = null;
  spatialIndex.clear();
  for (const [id, m] of session.currentShapes) {
    const shape = yToShape(m);
    shapeCache.set(id, shape);
    const util = shapeRegistry.getFor(shape);
    // Groups have no geometry of their own — keep them out of the index.
    if (util && shape.type !== 'group')
      spatialIndex.insert(id, shapeRotatedBounds(shape));
  }
  rebuildPagesCache();
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
  sortedShapesCache = null;
  spatialIndex.clear();
  cachedPages = {};
  cachedPageOrder = [];
  useDocumentStore.setState({
    boardId,
    doc: EMPTY_SNAPSHOT,
    shapes: [],
    currentPageId: DEFAULT_PAGE_ID,
  });
  useMusicPlaybackStore.getState().reset();

  const doc = new Y.Doc();
  const pages = doc.getMap('pages') as Y.Map<YPageMeta>;
  const music = doc.getMap('music');
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
    rebuildPagesCache();
    rebuildSnapshot();
  };
  pages.observeDeep(pagesObserver);

  const musicObserver = () => publishMusicPlayback();
  music.observe(musicObserver);

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
    music,
    currentShapes,
    currentPageId: DEFAULT_PAGE_ID,
    undo,
    unbindUndoState: bindUndoState(undo),
    shapesObserver,
    pagesObserver,
    musicObserver,
    persistence,
    provider,
    cleanup: () => {
      setActiveAwareness(null);
      session?.currentShapes.unobserveDeep(session.shapesObserver);
      pages.unobserveDeep(pagesObserver);
      music.unobserve(musicObserver);
      session?.unbindUndoState();
      session?.undo.destroy();
      provider?.destroy();
      persistence?.destroy();
      doc.destroy();
      useMusicPlaybackStore.getState().reset();
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
  publishMusicPlayback();

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
/** Force the next mutation to start a new undo entry (gesture boundary). */
export function breakUndoCapture(): void {
  session?.undo.stopCapturing();
}
export function redo(): void {
  session?.undo.redo();
}

// --- Pages API ---

/** Switch the active page (re-scopes observer, undo, cache, and camera). */
function switchToPageInternal(pageId: string): void {
  if (!session) return;
  session.currentShapes.unobserveDeep(session.shapesObserver);
  session.unbindUndoState();
  session.undo.destroy();

  const map = getShapesMap(session.doc, pageId);
  session.currentShapes = map;
  session.currentPageId = pageId;
  session.shapesObserver = makeShapesObserver();
  map.observeDeep(session.shapesObserver);
  session.undo = new Y.UndoManager(map, {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
  });
  session.unbindUndoState = bindUndoState(session.undo);

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

// --- Music playback API ---

export function setMusicPlayback(
  update: {
    trackId?: string | null;
    status?: MusicPlaybackStatus;
    position?: number;
    requestedBy?: string;
  },
): void {
  if (!session) return;
  const current = readMusicPlayback();
  const nextTrackId =
    update.trackId !== undefined ? update.trackId : current.trackId;
  const nextStatus = update.status ?? current.status;
  const nextPosition =
    update.position !== undefined
      ? Math.max(0, update.position)
      : current.position;
  const nextVersion = current.version + 1;

  session.doc.transact(() => {
    session?.music.set('trackId', nextTrackId);
    session?.music.set('status', nextStatus);
    session?.music.set('position', Number.isFinite(nextPosition) ? nextPosition : 0);
    session?.music.set('updatedAt', Date.now());
    session?.music.set('version', nextVersion);
    if (update.requestedBy?.trim()) {
      session?.music.set('requestedBy', update.requestedBy.trim());
    } else if ('requestedBy' in update) {
      session?.music.delete('requestedBy');
    }
  });
}

// --- Editor (stable; mutates the current page's Yjs map) ---

// Depth of nested local transactions currently open. While > 0 the `shapeCache`
// is stale relative to `currentShapes` (the deep observer that refreshes it only
// fires when the outermost transaction commits), so `getShape` must read the
// Yjs map directly. At depth 0 the cache is authoritative and reads are free.
let transactDepth = 0;

function transactLocal(fn: () => void): void {
  transactDepth++;
  try {
    session?.doc.transact(fn, LOCAL_ORIGIN);
  } finally {
    transactDepth--;
  }
}

export const editor: Editor = {
  getShape: (id) => {
    // Outside a transaction the cache mirrors the document, so hot read paths
    // (snap targeting, marquee, erase, reparent — each looping over many shapes
    // per drag frame) skip the per-call `yToShape` allocation and Yjs map reads.
    if (transactDepth === 0) {
      const cached = shapeCache.get(id);
      if (cached) return cached;
    }
    const m = session?.currentShapes.get(id);
    return m ? yToShape(m) : undefined;
  },
  getShapes: () => {
    if (!session) return [];
    // Served from the live shape cache (kept in sync by the Yjs observer), so
    // repeated per-gesture calls skip re-reading and re-sorting the whole map.
    return currentSortedShapes();
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
  // Yjs transactions are reentrant: the inner `transactLocal` calls made by
  // `updateShape` join this one, so the deep observer fires (and the snapshot
  // rebuilds) exactly once for the whole batch.
  transact: (fn) => transactLocal(fn),
};
