import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { create } from 'zustand';
import {
  DEFAULT_ANIMATION_PLAYBACK,
  DEFAULT_MUSIC_PLAYBACK,
  MAX_DOCUMENTS_PER_BOARD,
  genId,
  isAnimationRecording,
  type AnimationPlaybackState,
  type AnimationPlaybackStatus,
  type AnimationRecordingV1,
  type BoardDocumentMeta,
  type DrawPoint,
  type MusicPlaybackState,
  type MusicPlaybackStatus,
  type Page,
  type Shape,
  type WhiteboardDocument,
} from '@whiteboard/shared';
import type { Editor, ShapePatch } from './editor';
import { generateKeyBetween, jitterKeyBetween } from './order';
import {
  ensurePointsArray,
  readPoints,
  syncYPoints,
} from './shapes/ink-points';
import { shapeRegistry } from './shapes/shape-registry';
import { shapeRotatedBounds } from './shape-bounds';
import { SpatialIndex } from './spatial-index';
import { useCameraStore } from './use-camera-store';
import { useSelectionStore } from './use-selection-store';
import { type CommentMessage, useCommentsStore } from './use-comments-store';
import { useDocumentsStore } from './use-documents-store';
import { useConnectionStore } from '@/collab/use-connection-store';
import { startLatencyMonitor } from '@/collab/latency';
import {
  setActiveAwareness,
  setLocalLatency,
  setLocalPage,
} from '@/collab/presence';
import { useMusicPlaybackStore } from '@/music/use-music-playback-store';
import {
  isAnimationPageLocked,
  isAnimationPlaybackActive,
  useAnimationStore,
} from '@/animation/use-animation-store';

// page-default's shapes live at the doc root map `shapes` (unchanged from Pass 1),
// which keeps the Yjs structure idempotent across IndexedDB + server sync. Every
// other page stores its shapes in its own top-level map `shapes:<pageId>` —
// top-level named maps converge across clients with no migration. Page metadata
// (name + fractional order index) lives in the `pages` registry map.
const DEFAULT_PAGE_ID = 'page-default';
const DEFAULT_PAGE_NAME = 'Page 1';

/** Origin tag for this client's own mutations — only these are undoable. */
export const LOCAL_ORIGIN = 'local-user';
const ANIMATION_ORIGIN = 'animation-system';
// Comments are never part of undo history (not shapes, not selectable), so
// their origin is deliberately excluded from the UndoManager's trackedOrigins.
const COMMENT_ORIGIN = 'comments';
// Repository documents are board-level attachments, not canvas content — like
// comments, they're excluded from the UndoManager's trackedOrigins so Ctrl+Z
// never silently removes a file someone shared.
const DOCUMENTS_ORIGIN = 'documents';

/** Room name for a board's Yjs content (IndexedDB + Hocuspocus). */
export function boardRoom(boardId: string): string {
  return `whiteboard:board:${boardId}`;
}

function collabUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  // Dev: the collab server is proxied via Vite dev server on /collab. Use the
  // page's own protocol and host (not literal localhost or hardcoded ws: protocol)
  // so that HTTPS/WSS and single-port Cloudflare Tunnel setups work seamlessly.
  if (import.meta.env.DEV) {
    return `${proto}//${location.host}/collab`;
  }
  return `${proto}//${location.host}`;
}

export const spatialIndex = new SpatialIndex();

/**
 * Order by fractional index, breaking ties on id.
 *
 * The tiebreaker is what makes the result identical on every client. Without it
 * `sort` is merely stable, so two records sharing an index would fall back to
 * insertion order — which reflects the order events happened to arrive locally,
 * and so differs between clients. Shapes and pages both rely on this.
 */
function byIndexThenId(
  a: { id: string; index: string },
  b: { id: string; index: string },
): number {
  if (a.index !== b.index) return a.index < b.index ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Z-order comparator for shapes. */
export function compareIndex(a: Shape, b: Shape): number {
  return byIndexThenId(a, b);
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
  out.sort(byIndexThenId);
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
  } else if (shape.type === 'draw') {
    // Ink points are a growing sequence, for the same reason text is one. A
    // stroke is written once per frame while it is drawn; storing the array
    // inside `props` re-encoded the whole array each time, so an n-point stroke
    // cost O(n²) document bytes — paid by every peer and kept forever. As a
    // Y.Array the live path appends only the new points: O(n) for the stroke.
    const { points, ...props } = shape.props;
    m.set('props', props);
    m.set('points', Y.Array.from(points));
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
      : type === 'draw'
        ? { ...storedProps, points: readPoints(m, storedProps) }
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
    if (m.get('type') === 'draw' && Array.isArray(nextProps.points)) {
      // Promotes a legacy stroke to a Y.Array on first write (mirrors Y.Text).
      syncYPoints(ensurePointsArray(m), nextProps.points as DrawPoint[]);
      delete nextProps.points;
    }
    if (Object.keys(nextProps).length > 0) {
      const current =
        (m.get('props') as Record<string, unknown> | undefined) ?? {};
      const merged = { ...current, ...nextProps };
      // Once a legacy shape has a Y.Text, remove its stale scalar copy.
      if (m.get('type') === 'text' && m.get('text') instanceof Y.Text) {
        delete merged.text;
      }
      // Same for a promoted stroke: without this, any later prop change (a
      // recolor, say) would write the superseded point array back into `props`.
      if (m.get('type') === 'draw' && m.get('points') instanceof Y.Array) {
        delete merged.points;
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
  /** Legacy per-page recordings; migrated to the server library, then cleared. */
  animations: Y.Map<AnimationRecordingV1>;
  /** Shared animation transport state. */
  animationPlayback: Y.Map<unknown>;
  /** Comment thread messages, flat map keyed by message id (all pages). */
  comments: Y.Map<CommentMessage>;
  /** Board document repository metadata; the bytes live at /api/docs. */
  documents: Y.Map<BoardDocumentMeta>;
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
  animationsObserver: () => void;
  animationPlaybackObserver: () => void;
  commentsObserver: () => void;
  documentsObserver: () => void;
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
  // `metas` is already index-sorted (with an id tiebreaker), so take that order
  // directly rather than re-deriving it — re-sorting the keys here would drop
  // that tiebreaker and reintroduce per-client divergence on equal indices.
  // The unseeded fallback page (if any) keeps its historical spot at the front.
  const currentPageId = session.currentPageId;
  const ordered = metas.map((m) => m.id);
  cachedPageOrder = metas.some((m) => m.id === currentPageId)
    ? ordered
    : [currentPageId, ...ordered];
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

function readAnimationPlayback(): AnimationPlaybackState {
  if (!session) return DEFAULT_ANIMATION_PLAYBACK;
  const status = session.animationPlayback.get('status');
  return {
    recordingId: asStringOrNull(session.animationPlayback.get('recordingId')),
    status:
      status === 'playing' || status === 'paused' || status === 'stopped'
        ? status
        : DEFAULT_ANIMATION_PLAYBACK.status,
    positionMs: asNonNegativeNumber(
      session.animationPlayback.get('positionMs'),
      0,
    ),
    updatedAt: asNonNegativeNumber(
      session.animationPlayback.get('updatedAt'),
      0,
    ),
    version: asNonNegativeNumber(session.animationPlayback.get('version'), 0),
  };
}

// Legacy in-doc recordings: the animation layer registers a listener so the
// tutor client can migrate them to the server library once they sync in.
let legacyAnimationsListener: (() => void) | null = null;

export function setLegacyAnimationsListener(
  listener: (() => void) | null,
): void {
  legacyAnimationsListener = listener;
  if (listener && session && session.animations.size > 0) listener();
}

function notifyLegacyAnimations(): void {
  if (session && session.animations.size > 0) legacyAnimationsListener?.();
}

export function readLegacyAnimationRecordings(): AnimationRecordingV1[] {
  if (!session) return [];
  const recordings: AnimationRecordingV1[] = [];
  for (const [, value] of session.animations) {
    if (isAnimationRecording(value)) recordings.push(value);
  }
  return recordings;
}

export function clearLegacyAnimationRecordings(): void {
  if (!session) return;
  session.doc.transact(() => {
    session?.animations.clear();
  }, ANIMATION_ORIGIN);
}

function publishAnimationPlayback(): void {
  useAnimationStore.getState().setPlayback(readAnimationPlayback());
}

// --- Comments (flat map: message id -> plain CommentMessage object) ---

function readComments(): Record<string, CommentMessage> {
  if (!session) return {};
  const out: Record<string, CommentMessage> = {};
  for (const [id, message] of session.comments) out[id] = message;
  return out;
}

function publishComments(): void {
  useCommentsStore.getState().setMessages(readComments());
}

// --- Repository documents (flat map: document id -> BoardDocumentMeta) ---

function readDocuments(): Record<string, BoardDocumentMeta> {
  if (!session) return {};
  const out: Record<string, BoardDocumentMeta> = {};
  for (const [id, meta] of session.documents) out[id] = meta;
  return out;
}

function publishDocuments(): void {
  useDocumentsStore.getState().setDocuments(readDocuments());
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
    // Deliberately NOT jittered, unlike every other index write. Two clients
    // seeding concurrently both write the same registry key, so Yjs keeps one
    // and discards the other; a fixed index makes the two candidates byte-identical,
    // so it does not matter which side wins. Jitter is for distinct records that
    // must not tie, which is the opposite situation.
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
  useAnimationStore.getState().reset();
  useCommentsStore.getState().reset();
  useDocumentsStore.getState().reset();

  const doc = new Y.Doc();
  const pages = doc.getMap('pages') as Y.Map<YPageMeta>;
  const music = doc.getMap('music');
  const animations = doc.getMap<AnimationRecordingV1>('animations');
  const animationPlayback = doc.getMap('animation-playback');
  const comments = doc.getMap<CommentMessage>('comments');
  const documents = doc.getMap<BoardDocumentMeta>('documents');
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
  const animationsObserver = () => notifyLegacyAnimations();
  animations.observe(animationsObserver);
  const animationPlaybackObserver = () => publishAnimationPlayback();
  animationPlayback.observe(animationPlaybackObserver);
  const commentsObserver = () => publishComments();
  comments.observe(commentsObserver);
  const documentsObserver = () => publishDocuments();
  documents.observe(documentsObserver);

  const persistence = opts.persist
    ? new IndexeddbPersistence(boardRoom(boardId), doc)
    : null;

  let provider: HocuspocusProvider | null = null;
  let stopLatencyMonitor = () => {};
  if (opts.collab) {
    provider = new HocuspocusProvider({
      url: collabUrl(),
      name: boardId,
      document: doc,
    });
    provider.on('status', (event: { status: string }) => {
      useConnectionStore.getState().setStatus(event.status);
    });
    stopLatencyMonitor = startLatencyMonitor(provider, setLocalLatency);
    setActiveAwareness(provider.awareness ?? null);
  } else {
    useConnectionStore.getState().setStatus('disconnected');
  }

  session = {
    boardId,
    doc,
    pages,
    music,
    animations,
    animationPlayback,
    comments,
    documents,
    currentShapes,
    currentPageId: DEFAULT_PAGE_ID,
    undo,
    unbindUndoState: bindUndoState(undo),
    shapesObserver,
    pagesObserver,
    musicObserver,
    animationsObserver,
    animationPlaybackObserver,
    commentsObserver,
    documentsObserver,
    persistence,
    provider,
    cleanup: () => {
      setActiveAwareness(null);
      session?.currentShapes.unobserveDeep(session.shapesObserver);
      pages.unobserveDeep(pagesObserver);
      music.unobserve(musicObserver);
      animations.unobserve(animationsObserver);
      animationPlayback.unobserve(animationPlaybackObserver);
      comments.unobserve(commentsObserver);
      documents.unobserve(documentsObserver);
      session?.unbindUndoState();
      session?.undo.destroy();
      stopLatencyMonitor();
      provider?.destroy();
      persistence?.destroy();
      doc.destroy();
      useMusicPlaybackStore.getState().reset();
      useAnimationStore.getState().reset();
      useCommentsStore.getState().reset();
      useDocumentsStore.getState().reset();
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
  notifyLegacyAnimations();
  publishAnimationPlayback();
  publishComments();
  publishDocuments();

  let disposed = false;
  return () => {
    if (disposed || session?.doc !== doc) return;
    disposed = true;
    session.cleanup();
    session = null;
  };
}

export function undo(): void {
  if (isAnimationPlaybackActive()) return;
  session?.undo.undo();
}
/** Force the next mutation to start a new undo entry (gesture boundary). */
export function breakUndoCapture(): void {
  session?.undo.stopCapturing();
}
export function redo(): void {
  if (isAnimationPlaybackActive()) return;
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
  if (isAnimationPageLocked()) return;
  if (!session || session.currentPageId === pageId) return;
  switchToPageInternal(pageId);
}

/** Playback-only page switch that bypasses the local interaction lock. */
export function setCurrentPageForAnimation(pageId: string): void {
  if (!session || session.currentPageId === pageId || !session.pages.has(pageId)) {
    return;
  }
  switchToPageInternal(pageId);
}

/** Create a new page after the current one and switch to it. Returns its id. */
export function createPage(name?: string): string {
  if (isAnimationPageLocked()) return '';
  if (!session) return '';
  const id = genId();
  const metas = readPages(session.pages);
  const at = metas.findIndex((m) => m.id === session!.currentPageId);
  const before =
    at >= 0 ? (metas[at]?.index ?? null) : (metas.at(-1)?.index ?? null);
  const after = at >= 0 ? (metas[at + 1]?.index ?? null) : null;
  const index = jitterKeyBetween(before, after);
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
  if (isAnimationPageLocked()) return;
  if (!session) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  session.doc.transact(() => {
    const m = session!.pages.get(id);
    if (m) m.set('name', trimmed);
  });
}

export function deletePage(id: string): void {
  if (isAnimationPageLocked()) return;
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
  }, ANIMATION_ORIGIN);
}

/** Move a page to a resolved list position with one fractional-index write. */
export function movePageToIndex(id: string, targetIndex: number): void {
  if (isAnimationPageLocked()) return;
  if (!session) return;
  const metas = readPages(session.pages);
  const currentIndex = metas.findIndex((meta) => meta.id === id);
  if (currentIndex < 0) return;
  const clampedTarget = Math.max(0, Math.min(metas.length - 1, targetIndex));
  if (clampedTarget === currentIndex) return;

  const remaining = metas.filter((meta) => meta.id !== id);
  const before = remaining[clampedTarget - 1]?.index ?? null;
  const after = remaining[clampedTarget]?.index ?? null;
  const index = jitterKeyBetween(before, after);
  session.doc.transact(() => {
    session!.pages.get(id)?.set('index', index);
  });
}

/** Move a page one slot with the same index-based operation used by dragging. */
export function movePage(id: string, direction: 'up' | 'down'): void {
  if (!session) return;
  const metas = readPages(session.pages);
  const currentIndex = metas.findIndex((meta) => meta.id === id);
  if (currentIndex < 0) return;
  movePageToIndex(id, direction === 'up' ? currentIndex - 1 : currentIndex + 1);
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

// --- Whiteboard animation API ---

export function setAnimationPlayback(update: {
  recordingId?: string | null;
  status?: AnimationPlaybackStatus;
  positionMs?: number;
}): void {
  if (!session) return;
  const current = readAnimationPlayback();
  const recordingId =
    update.recordingId !== undefined ? update.recordingId : current.recordingId;
  const status = update.status ?? current.status;
  const positionMs = Math.max(0, update.positionMs ?? current.positionMs);
  session.doc.transact(() => {
    session?.animationPlayback.set('recordingId', recordingId);
    session?.animationPlayback.set('status', status);
    session?.animationPlayback.set('positionMs', positionMs);
    session?.animationPlayback.set('updatedAt', Date.now());
    session?.animationPlayback.set('version', current.version + 1);
  }, ANIMATION_ORIGIN);
}

// --- Comments API ---
// A flat map keyed by message id: the thread root (id === threadId) carries
// the pin position and resolved flag; replies just point back via threadId.
// Concurrent replies from two clients never conflict since each is its own key.

/** Start a new comment thread pinned at a world position. Returns its id. */
export function addComment(input: {
  pageId: string;
  x: number;
  y: number;
  text: string;
  author: { name: string; color: string };
}): string {
  const id = genId();
  if (!session) return id;
  const message: CommentMessage = {
    id,
    pageId: input.pageId,
    threadId: id,
    x: input.x,
    y: input.y,
    text: input.text,
    authorName: input.author.name,
    authorColor: input.author.color,
    createdAt: Date.now(),
    resolved: false,
  };
  session.doc.transact(() => {
    session?.comments.set(id, message);
  }, COMMENT_ORIGIN);
  return id;
}

/** Append a reply to an existing thread. Returns the reply's id. */
export function addCommentReply(
  threadId: string,
  text: string,
  author: { name: string; color: string },
): string {
  const id = genId();
  if (!session) return id;
  const root = session.comments.get(threadId);
  if (!root) return id;
  const message: CommentMessage = {
    id,
    pageId: root.pageId,
    threadId,
    text,
    authorName: author.name,
    authorColor: author.color,
    createdAt: Date.now(),
  };
  session.doc.transact(() => {
    session?.comments.set(id, message);
  }, COMMENT_ORIGIN);
  return id;
}

/** Mark a thread resolved/unresolved. Resolved threads are hidden on canvas. */
export function setThreadResolved(threadId: string, resolved: boolean): void {
  if (!session) return;
  const root = session.comments.get(threadId);
  if (!root) return;
  session.doc.transact(() => {
    session?.comments.set(threadId, { ...root, resolved });
  }, COMMENT_ORIGIN);
}

/** Delete a thread's root message and all of its replies. */
export function deleteCommentThread(threadId: string): void {
  if (!session) return;
  session.doc.transact(() => {
    for (const [id, message] of session!.comments) {
      if (message.threadId === threadId) session!.comments.delete(id);
    }
  }, COMMENT_ORIGIN);
}

/** How many documents the board's repository currently holds. */
export function boardDocumentCount(): number {
  return session?.documents.size ?? 0;
}

/** Whether the repository has room for another document. */
export function boardDocumentsFull(): boolean {
  return boardDocumentCount() >= MAX_DOCUMENTS_PER_BOARD;
}

/** Publish an uploaded document to everyone on the board. */
export function addBoardDocument(meta: BoardDocumentMeta): void {
  if (!session) return;
  session.doc.transact(() => {
    session?.documents.set(meta.id, meta);
  }, DOCUMENTS_ORIGIN);
}

/** Remove a document from the board. The stored bytes are left in place —
 *  they're content-addressed and may be shared with another board. */
export function removeBoardDocument(id: string): void {
  if (!session) return;
  session.doc.transact(() => {
    session?.documents.delete(id);
  }, DOCUMENTS_ORIGIN);
}

/**
 * Encoded size of the whole board document, in bytes.
 *
 * Every edit is retained by the CRDT, so this measures accumulated write cost,
 * not just live content — which makes it the direct way to check that drawing a
 * stroke stays linear in its point count rather than quadratic.
 */
export function documentByteSize(): number {
  if (!session) return 0;
  return Y.encodeStateAsUpdate(session.doc).byteLength;
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
    !isAnimationPlaybackActive()
      ? transactLocal(() => session?.currentShapes.set(shape.id, shapeToY(shape)))
      : undefined,
  updateShape: (id, patch) =>
    !isAnimationPlaybackActive()
      ? transactLocal(() => {
          const m = session?.currentShapes.get(id);
          if (m) applyPatchToY(m, patch);
        })
      : undefined,
  deleteShapes: (ids) =>
    !isAnimationPlaybackActive()
      ? transactLocal(() => {
          for (const id of ids) session?.currentShapes.delete(id);
        })
      : undefined,
  // Yjs transactions are reentrant: the inner `transactLocal` calls made by
  // `updateShape` join this one, so the deep observer fires (and the snapshot
  // rebuilds) exactly once for the whole batch.
  transact: (fn) => {
    if (!isAnimationPlaybackActive()) transactLocal(fn);
  },
};
