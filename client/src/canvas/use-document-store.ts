import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import {
  HocuspocusProvider,
  HocuspocusProviderWebsocket,
} from '@hocuspocus/provider';
import { create } from 'zustand';
import {
  DEFAULT_MUSIC_PLAYBACK,
  MAX_CUSTOM_STICKERS_PER_BOARD,
  MAX_DOCUMENTS_PER_BOARD,
  genId,
  type BoardDocumentMeta,
  type CustomStickerMeta,
  type DrawPoint,
  type GraphExpression,
  type MusicPlaybackState,
  type MusicPlaybackStatus,
  type Page,
  type Shape,
  type WhiteboardDocument,
} from '@whiteboard/shared';
import type { Editor, ShapePatch } from './editor';
import { collectSubtree, deleteShapesWithCleanup } from './commands';
import { generateKeyBetween, jitterKeyBetween } from './order';
import {
  encodePointsForStorage,
  ensurePointsArray,
  readPoints,
  syncYPoints,
} from './shapes/ink-points';
import {
  encodeGraphExpressionsForStorage,
  ensureGraphExpressionsArray,
  readGraphExpressions,
  syncYGraphExpressions,
} from './shapes/graph-storage';
import { shapeRegistry } from './shapes/shape-registry';
import { shapeRotatedBounds } from './shape-bounds';
import type { Bounds } from './geometry';
import { BindingGraph } from './binding-graph';
import { SpatialIndex } from './spatial-index';
import {
  subscribeToTextMetrics,
  watchFontLoading,
} from './shapes/text-measure';
import { useCameraStore } from './use-camera-store';
import { type CommentMessage, useCommentsStore } from './use-comments-store';
import { useCustomStickersStore } from './use-custom-stickers-store';
import { useDocumentsStore } from './use-documents-store';
import { useEraserCutStore } from './use-eraser-cut-store';
import { useEraserStore } from './use-eraser-store';
import { useHiddenStore } from './use-hidden-store';
import { getLiveStrokeShapeId } from './use-live-stroke-store';
import { resolveOpacity } from './opacity';
import { clearVanishing, vanishShapes } from './use-vanish-store';
import { useConnectionStore } from '@/collab/use-connection-store';
import { startLatencyMonitor } from '@/collab/latency';
import { noteActivity, startAttentionMonitor } from '@/collab/attention';
import { bindVoiceProvider } from '@/collab/voice/voice-session';
import {
  setActiveAwareness,
  setLocalCursor,
  setLocalLatency,
  setLocalPage,
} from '@/collab/presence';
import { stopFollowingForManualCameraChange } from '@/collab/use-follow-store';
import { useMusicPlaybackStore } from '@/music/use-music-playback-store';
import {
  deletePageInteractionState,
  enterPageInteractionState,
  leavePageInteractionState,
  resetPageInteractionStates,
} from './page-interaction-state';
import {
  acquirePageDoc,
  closePageDocs,
  deleteStoredPage,
  destroyPageDoc,
  openPageDocs,
  pinPageDoc,
  residentPageDoc,
  unpinPageDoc,
  type PageDoc,
} from './page-docs';
import { legacyShapesMap, migrateLegacyShapes } from './page-migration';
import { getIncrementedName } from './page-names';
import { readPageSession, writePageSession } from './page-session-state';
import { completeInteractionBeforePageSwitch } from './page-transition';

// A board is a small tree of CRDT documents. This one — the board document —
// holds the page registry (name + fractional order index per page) and the
// board-level shared state; each page's shapes live in a document of their own,
// synced only while that page is resident. See page-docs.ts for why.
//
// Boards written before that split kept every page's shapes in this document:
// page-default at the root map `shapes`, the rest at `shapes:<pageId>`. Those
// maps are still read, and the first time such a page is opened its shapes move
// into the page's own document and the legacy map is emptied.
const DEFAULT_PAGE_ID = 'page-default';
const DEFAULT_PAGE_NAME = 'Page 1';

/** Origin tag for this client's own mutations — only these are undoable. */
export const LOCAL_ORIGIN = 'local-user';
// Comments are never part of undo history (not shapes, not selectable), so
// their origin is deliberately excluded from the UndoManager's trackedOrigins.
const COMMENT_ORIGIN = 'comments';
// Repository documents are board-level attachments, not canvas content — like
// comments, they're excluded from the UndoManager's trackedOrigins so Ctrl+Z
// never silently removes a file someone shared.
const DOCUMENTS_ORIGIN = 'documents';
// The board's custom sticker library is a shared asset, not canvas content:
// excluded from undo for the same reason as documents, so Ctrl+Z never removes
// a sticker a collaborator just added.
const STICKERS_ORIGIN = 'stickers';
// Shapes that only exist while a gesture is in progress (see `withoutUndo`),
// excluded from the UndoManager so a gesture that leaves nothing behind also
// leaves no undo entry behind.
const EPHEMERAL_ORIGIN = 'ephemeral';
// The receiving half of a cross-page move. Untracked so the target page's own
// history is not disturbed by shapes arriving from elsewhere: the move belongs
// to the page it was made from, and is undone from there (see `undo`).
const CROSS_PAGE_ORIGIN = 'cross-page';
// Relocating a legacy board's shapes into their page documents. Untracked: it
// is a change of storage, not an edit anyone made or should be able to undo.
const MIGRATION_ORIGIN = 'migration';

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

/** `target -> bound arrows`, kept in sync with the spatial index. */
export const bindingGraph = new BindingGraph();

/**
 * Shape ids changed since the connector sync last ran, or `null` to mean "the
 * whole page changed, rescan everything" (initial load, page switch, resync).
 *
 * Accumulated rather than overwritten: React can batch several store updates
 * into one effect run, and dropping the earlier ones would leave those arrows
 * unresolved until something else happened to touch them.
 */
let pendingBindingDirty: Set<string> | null = null;

function markBindingDirty(ids: Iterable<string>): void {
  // Already pending a full rescan — narrowing it now would lose work.
  if (pendingBindingDirty === null) return;
  for (const id of ids) pendingBindingDirty.add(id);
}

/**
 * Drain the pending dirty set. Returns `null` when a full rescan is required.
 * Callers expand it across binding edges via {@link bindingGraph}.
 */
export function takeBindingDirty(): Set<string> | null {
  const out = pendingBindingDirty;
  pendingBindingDirty = new Set();
  return out;
}

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
    // Base64 Float32-anchor / Float16-delta chunks: see ink-points.ts.
    m.set('points', Y.Array.from(encodePointsForStorage(points)));
  } else if (shape.type === 'graph') {
    // One Y.Map per curve, so collaborators editing different rows of the same
    // plot don't overwrite each other. See graph-storage.ts.
    const { expressions, ...props } = shape.props;
    m.set('props', props);
    m.set(
      'expressions',
      Y.Array.from(encodeGraphExpressionsForStorage(expressions)),
    );
  } else {
    m.set('props', shape.props);
  }
  return m;
}

function yToShape(m: YShape): Shape {
  const type = m.get('type');
  const storedProps =
    (m.get('props') as Record<string, unknown> | undefined) ?? {};
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
        ? // Shared and grown in place as the stroke does, like `getShapes()`'s
          // sorted view — read it, don't mutate or retain it. Copying here would
          // put back the per-frame O(n) decode that made drawing quadratic.
          { ...storedProps, points: readPoints(m, storedProps) }
        : type === 'graph'
          ? {
              ...storedProps,
              expressions: readGraphExpressions(m, storedProps),
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
    if (m.get('type') === 'draw' && Array.isArray(nextProps.points)) {
      // Promotes a legacy stroke to a Y.Array on first write (mirrors Y.Text).
      syncYPoints(ensurePointsArray(m), nextProps.points as DrawPoint[]);
      delete nextProps.points;
    }
    if (m.get('type') === 'graph' && Array.isArray(nextProps.expressions)) {
      syncYGraphExpressions(
        ensureGraphExpressionsArray(m),
        nextProps.expressions as GraphExpression[],
      );
      delete nextProps.expressions;
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
      if (
        m.get('type') === 'graph' &&
        m.get('expressions') instanceof Y.Array
      ) {
        delete merged.expressions;
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
  /** Comment thread messages, flat map keyed by message id (all pages). */
  comments: Y.Map<CommentMessage>;
  /** Board document repository metadata; the bytes live at /api/docs. */
  documents: Y.Map<BoardDocumentMeta>;
  /** The board's custom sticker library; the artwork lives at /api/blobs. */
  stickers: Y.Map<CustomStickerMeta>;
  /** The active page's document and its `shapes` map. Both are swapped on a
   *  page switch; `shapesDoc` is what shape mutations transact on, while `doc`
   *  above stays the board document (registry, comments, stickers, music). */
  pageDoc: PageDoc;
  shapesDoc: Y.Doc;
  currentShapes: Y.Map<YShape>;
  currentPageId: string;
  /** Derived state for pages left behind but still resident, keyed by page id.
   *  A switch back to one of these restores it instead of re-deriving the page
   *  from the CRDT — see {@link parkActivePage}. */
  parked: Map<string, ParkedPage>;
  /** Pages pinned resident because their undo history is worth keeping, most
   *  recently edited last. */
  pagesWithHistory: Set<string>;
  /** Shared by the board document's provider and every page's, so a resident
   *  page costs sync scope rather than another socket. */
  socket: HocuspocusProviderWebsocket | null;
  /** True until stored local session state is restored or user navigation wins. */
  pageRestorePending: boolean;
  undo: Y.UndoManager;
  /** Per-page managers retain undo and redo stacks while their page is inactive. */
  undoByPage: Map<string, Y.UndoManager>;
  /** Detaches the undo-state listeners; swapped on page switch. */
  unbindUndoState: () => void;
  /** Deep observer bound to `currentShapes`; swapped on page switch. */
  shapesObserver: (events: Y.YEvent<Y.AbstractType<unknown>>[]) => void;
  pagesObserver: () => void;
  musicObserver: () => void;
  commentsObserver: () => void;
  documentsObserver: () => void;
  stickersObserver: () => void;
  persistence: IndexeddbPersistence | null;
  provider: HocuspocusProvider | null;
  cleanup: () => void;
}

let session: Session | null = null;

// The active page's decoded shapes. Reassigned (not cleared) on a page switch,
// so a page left behind keeps its own map to come back to — see `ParkedPage`.
let shapeCache = new Map<string, Shape>();
// Lazily-built, z-sorted view of `shapeCache` for `editor.getShapes()`. The
// cache stays in sync with `shapeCache` (invalidated wherever it mutates), so
// reads avoid re-deserializing the whole Yjs map and re-sorting on every call —
// tools hit this many times per pointer event. The array is shared; callers
// treat it as read-only (none mutate it in place).
let sortedShapesCache: Shape[] | null = null;

// Each id's slot in `sortedShapesCache`, so the same-order update path in
// `applyAffected` can overwrite changed entries by position. Only a re-sort
// invalidates it — the positional copy carries it forward untouched, which is
// the whole point: it must survive the array identity changing every frame.
let sortedPositionById: Map<string, number> | null = null;

// How many shapes on the current page make the Canvas's per-frame hierarchy and
// equation derivations worth running at all. Maintained here beside the spatial
// and binding indexes, for the same reason they are: a stroke publishes a new
// `shapes` array every frame, and on a page with no parented shape the walks
// that rebuild `childrenByParent`/`frameAncestorIds` produce two empty
// collections at O(page) cost per frame. Almost every real page is that page.
let parentedCount = 0;
let equationCount = 0;

/**
 * Everything derived from a page that is no longer the active one.
 *
 * A page switch used to throw all of this away and rebuild it from the CRDT on
 * the way back — decode every shape, re-insert every bound into the R-tree —
 * which is the bulk of what a switch costs. Flipping between two pages is the
 * common case (a worked example on one, the exercise on the other), so the last
 * few pages keep their derived state and a switch back is a pointer swap.
 *
 * `stale` is how that stays honest: while a page is parked its document is
 * still syncing, and a peer's edit invalidates the snapshot. Rather than apply
 * changes to a page nobody is looking at, the watcher just marks it, and the
 * switch back falls through to a full re-derivation.
 */
interface ParkedPage {
  shapes: Map<string, Shape>;
  sorted: Shape[] | null;
  positions: Map<string, number> | null;
  index: SpatialIndex;
  bindings: BindingGraph;
  parented: number;
  equations: number;
  stale: boolean;
  detach: () => void;
}

/** Hand the active page's derived state to `parked`, leaving the live ones empty. */
function parkActivePage(): void {
  if (!session) return;
  const pageId = session.currentPageId;
  const page = session.pageDoc;
  const entry: ParkedPage = {
    shapes: shapeCache,
    sorted: sortedShapesCache,
    positions: sortedPositionById,
    index: new SpatialIndex(),
    bindings: new BindingGraph(),
    parented: parentedCount,
    equations: equationCount,
    stale: false,
    detach: () => {},
  };
  entry.index.adopt(spatialIndex);
  entry.bindings.adopt(bindingGraph);

  const watcher = () => {
    entry.stale = true;
  };
  page.shapes.observeDeep(watcher);
  entry.detach = () => page.shapes.unobserveDeep(watcher);

  session.parked.set(pageId, entry);
  shapeCache = new Map();
  sortedShapesCache = null;
  sortedPositionById = null;
  parentedCount = 0;
  equationCount = 0;
}

/** Drop a parked page's snapshot and its stale watcher. */
function discardParkedPage(pageId: string): void {
  const entry = session?.parked.get(pageId);
  if (!entry) return;
  entry.detach();
  session!.parked.delete(pageId);
}

/**
 * Make a parked page's derived state live again. False when there is nothing
 * usable to restore and the caller must re-derive the page from its document.
 */
function unparkPage(pageId: string): boolean {
  const entry = session?.parked.get(pageId);
  if (!entry) return false;
  entry.detach();
  session!.parked.delete(pageId);
  if (entry.stale) return false;

  clearVanishing();
  shapeCache = entry.shapes;
  sortedShapesCache = entry.sorted;
  sortedPositionById = entry.positions;
  parentedCount = entry.parented;
  equationCount = entry.equations;
  spatialIndex.adopt(entry.index);
  bindingGraph.adopt(entry.bindings);
  // The Canvas resolves connectors against the page it is rendering, so the
  // page coming back needs the same full rescan a freshly derived one gets.
  pendingBindingDirty = null;
  rebuildPagesCache();
  rebuildSnapshot();
  return true;
}

/** Current page's shapes, z-sorted. One shared array for `getShapes()` and the
 *  store snapshot, so consumers never re-sort the document themselves. */
function currentSortedShapes(): Shape[] {
  if (!sortedShapesCache) {
    sortedShapesCache = [...shapeCache.values()].sort(compareIndex);
    // Rebuilt lazily against the new order, on the first frame that needs it.
    sortedPositionById = null;
  }
  return sortedShapesCache;
}

interface DocStore {
  boardId: string;
  /**
   * Page metadata and order. Identity is stable across shape mutations — only
   * a change to the page registry rebuilds it — so the page menu and the board
   * chrome no longer re-render once per frame of every drag.
   */
  doc: WhiteboardDocument;
  /** Current page's shapes, z-sorted. Reference is stable until a shape
   *  mutates, so camera-only renders don't invalidate consumers' memos and no
   *  component re-derives `Object.values(...).sort(...)` per render. */
  shapes: Shape[];
  /**
   * The live shape cache, for consumers that look one shape up by id.
   *
   * Its identity is stable for the life of a page: the map is mutated in place,
   * and every reader is a zustand selector, which re-runs on every store write
   * anyway (a page switch is one such write). That is
   * the whole point — publishing lookups as a fresh `Record` copied the entire
   * page on every mutation, which is O(n) per frame of a drag and allocates a
   * hash entry per shape, to answer questions of the form `get(oneId)`.
   *
   * Read-only to consumers.
   */
  shapesById: ReadonlyMap<string, Shape>;
  /**
   * Whether the current page contains any parented shape / any equation.
   *
   * The Canvas rebuilds `childrenByParent`, `frameAncestorIds` and its equation
   * list from `shapes`, which gets a new identity on every mutation — so once
   * per frame for the whole of a stroke or drag. On a page with no parenting
   * all of that work yields empty collections, and most pages have none. These
   * flags let those memos return shared empties instead of walking the page.
   */
  hasHierarchy: boolean;
  hasEquations: boolean;
  currentPageId: string;
}

const EMPTY_SNAPSHOT: WhiteboardDocument = { pages: {}, pageOrder: [] };

export const useDocumentStore = create<DocStore>(() => ({
  boardId: '',
  doc: EMPTY_SNAPSHOT,
  shapes: [],
  shapesById: shapeCache,
  hasHierarchy: false,
  hasEquations: false,
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

// Cached page metadata (ids, names, order), rebuilt only when the pages
// registry actually changes. Shape-only mutations (draw/drag) republish this
// object as-is rather than re-reading the registry and re-sorting the page
// order, so a subscriber to `doc` or `doc.pages` sees a stable reference right
// through a gesture and never re-renders for it.
let cachedDoc: WhiteboardDocument = EMPTY_SNAPSHOT;
let cachedPages: Record<string, Page> = {};
let cachedPageOrder: string[] = [];

/** Recompute the cached page skeleton from the registry. Cheap in the number of
 *  pages; call only when the pages map changes or the active page switches. */
function rebuildPagesCache(): void {
  if (!session) {
    cachedPages = {};
    cachedPageOrder = [];
    cachedDoc = EMPTY_SNAPSHOT;
    return;
  }
  const metas = readPages(session.pages);
  const pages: Record<string, Page> = {};
  for (const meta of metas) {
    pages[meta.id] = { id: meta.id, name: meta.name };
  }
  // Before the registry is seeded (legacy/new board), still present the current
  // page so the canvas + page menu have something to render.
  if (!pages[session.currentPageId]) {
    pages[session.currentPageId] = {
      id: session.currentPageId,
      name: DEFAULT_PAGE_NAME,
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
  cachedDoc = { pages: cachedPages, pageOrder: cachedPageOrder };
}

// A snapshot publish deferred to the next frame. See `publishSnapshotSoon`.
let queuedSnapshotFrame: number | null = null;

/** Drop a deferred publish, because one has just happened or the page is gone. */
function cancelQueuedSnapshot(): void {
  if (queuedSnapshotFrame === null) return;
  cancelAnimationFrame(queuedSnapshotFrame);
  queuedSnapshotFrame = null;
}

/**
 * Publish at most one snapshot per frame, for edits that did not come from this
 * client's own input.
 *
 * A peer draws at the rate of their own digitizer, and the draw tool writes a
 * frame of the stroke per animation frame, so a 120 Hz tablet emits 120
 * document updates a second — each one its own message, its own transaction,
 * and until now its own `rebuildSnapshot`, Canvas render and reconciliation of
 * every visible shape. Two or three people drawing at once therefore drove the
 * receiver's React tree several times faster than it could paint, and all but
 * the last render of each frame was discarded before it ever reached the
 * screen.
 *
 * Everything in `applyAffected` above this still runs synchronously on every
 * update, so `getShape`, hit-testing, the spatial index and the binding graph
 * are never behind the document. Only the React publish waits, and it waits at
 * most one frame — which is as often as the result could have been seen.
 *
 * This is the same bargain the local live stroke already makes, in the other
 * direction: there the ink is on screen before the snapshot would have been, so
 * the publish is skipped outright; here the publish is what puts it on screen,
 * so it is kept and merely paced.
 */
function publishSnapshotSoon(): void {
  // No frames to schedule against (node, tests, SSR): publish now. Pacing is an
  // optimization, never a correctness requirement.
  if (typeof requestAnimationFrame !== 'function') {
    rebuildSnapshot();
    return;
  }
  if (queuedSnapshotFrame !== null) return;
  queuedSnapshotFrame = requestAnimationFrame(() => {
    queuedSnapshotFrame = null;
    rebuildSnapshot();
  });
}

function rebuildSnapshot(): void {
  // Whatever a deferred publish was going to say, this one says at least as
  // much: both read the same live caches, and this is the later of the two.
  cancelQueuedSnapshot();
  if (!session) return;
  // Nothing here is proportional to the number of shapes on the page. The
  // sorted array is maintained incrementally by `applyAffected`, page metadata
  // is republished by reference, and lookups are served from the live cache.
  useDocumentStore.setState({
    doc: cachedDoc,
    shapes: currentSortedShapes(),
    // Republished because the cache belongs to the page, not to the board: a
    // switch swaps in the target page's map, and a consumer still holding the
    // one it had would be looking shapes up on the page it just left. Within a
    // page the reference never changes, so this costs subscribers nothing.
    shapesById: shapeCache,
    hasHierarchy: parentedCount > 0,
    hasEquations: equationCount > 0,
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

// --- Custom stickers (flat map: sticker id -> CustomStickerMeta) ---

function readCustomStickers(): Record<string, CustomStickerMeta> {
  if (!session) return {};
  const out: Record<string, CustomStickerMeta> = {};
  for (const [id, meta] of session.stickers) out[id] = meta;
  return out;
}

function publishCustomStickers(): void {
  useCustomStickersStore.getState().setStickers(readCustomStickers());
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

/**
 * Start the fade-out for shapes that just left the document.
 *
 * Called from the shape observer rather than from `deleteShapes`, so a peer's
 * delete, an undone create and the eraser all fade the same way — anything that
 * removes a shape from the page passes through here exactly once.
 *
 * Two kinds of shape are exempt, because a ghost would put them back on screen
 * in a state the user never saw:
 *  - locally hidden shapes, which were not being rendered at all;
 *  - shapes the precision eraser is mid-cut on, whose surviving fragments have
 *    been standing in for them all stroke. Fading the uncut original over those
 *    fragments would flash the erased ink back for the length of the animation.
 */
function startVanish(removed: Shape[]): void {
  if (removed.length === 0) return;
  const hidden = useHiddenStore.getState().hidden;
  const cutting = useEraserCutStore.getState().fragments;
  const isMarked = useEraserStore.getState().isMarked;
  // Deleting a group deletes its children in the same batch, so ancestors may
  // already be out of the cache — resolve opacity against the batch too, or a
  // child of a faded group would ghost back at full strength.
  const removedById = new Map(removed.map((s) => [s.id, s]));
  const getShape = (id: string) => shapeCache.get(id) ?? removedById.get(id);
  const entries: { shape: Shape; opacity: number }[] = [];
  for (const shape of removed) {
    if (hidden[shape.id] || shape.id in cutting) continue;
    entries.push({ shape, opacity: resolveOpacity(shape, getShape, isMarked) });
  }
  vanishShapes(entries);
}

function applyAffected(ids: Set<string>, paced = false): void {
  if (!session) return;
  // A stroke or drag mutates a shape's props/position but never its z-`index`
  // or the set of shapes, so the sorted order is unchanged. Track whether any
  // affected id was added, removed, or re-indexed; if not, we can build the next
  // sorted array by swapping the changed entries in place (O(N), no re-sort).
  let orderChanged = false;
  const updated = new Map<string, Shape>();
  const removed: Shape[] = [];
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
      bindingGraph.update(shape);
      parentedCount += (shape.parentId ? 1 : 0) - (prev?.parentId ? 1 : 0);
      equationCount +=
        (shape.type === 'equation' ? 1 : 0) -
        (prev?.type === 'equation' ? 1 : 0);
      if (!prev || prev.index !== shape.index) orderChanged = true;
      else updated.set(id, shape);
    } else {
      const prev = shapeCache.get(id);
      if (prev) removed.push(prev);
      if (prev?.parentId) parentedCount--;
      if (prev?.type === 'equation') equationCount--;
      shapeCache.delete(id);
      spatialIndex.remove(id);
      bindingGraph.remove(id);
      orderChanged = true;
    }
  }
  startVanish(removed);
  markBindingDirty(ids);
  if (orderChanged || !sortedShapesCache) {
    sortedShapesCache = null;
  } else {
    // Same membership and order — copy the array and overwrite only the changed
    // slots. Mapping over it instead cost a closure call and a Map lookup for
    // every shape on the page to replace the one or two a drag frame touches.
    const sorted = sortedShapesCache;
    sortedPositionById ??= new Map(sorted.map((s, i) => [s.id, i]));
    const next = sorted.slice();
    for (const [id, shape] of updated) {
      const i = sortedPositionById.get(id);
      if (i !== undefined) next[i] = shape;
    }
    sortedShapesCache = next;
  }
  // A frame of the stroke the local pointer is drawing, and nothing else. The
  // active-stroke layer has already put that frame on screen — straight to the
  // DOM, before the paint it was computed for — so a snapshot here would buy a
  // Canvas re-render and the whole page's worth of derived state to move a path
  // that is already where it belongs. The write itself still happened, so peers
  // watch the stroke appear exactly as before, and everything above still ran,
  // so `getShape`, hit-testing and the spatial index stay current.
  //
  // Any other id in the batch — a peer's edit, an arrow rerouting — publishes as
  // usual, so remote work is never held up behind a local gesture.
  const live = getLiveStrokeShapeId();
  if (live !== null && ids.size === 1 && ids.has(live)) return;
  if (paced) publishSnapshotSoon();
  else rebuildSnapshot();
}

function fullResync(): void {
  if (!session) return;
  // Ghosts belong to the page that was on screen; the board is being rebuilt
  // under them, so drop them rather than fade them over the new page.
  clearVanishing();
  shapeCache.clear();
  sortedShapesCache = null;
  spatialIndex.clear();
  bindingGraph.clear();
  pendingBindingDirty = null;
  parentedCount = 0;
  equationCount = 0;
  // Collected and handed to the R-tree in one bulk load rather than inserted
  // one by one: the tree is built in a single packing pass instead of n
  // descend-and-split insertions, and comes out better balanced for every
  // later query.
  const bounds: (Bounds & { id: string })[] = [];
  for (const [id, m] of session.currentShapes) {
    const shape = yToShape(m);
    shapeCache.set(id, shape);
    const util = shapeRegistry.getFor(shape);
    // Groups have no geometry of their own — keep them out of the index.
    if (util && shape.type !== 'group')
      bounds.push({ ...shapeRotatedBounds(shape), id });
    bindingGraph.update(shape);
    if (shape.parentId) parentedCount++;
    if (shape.type === 'equation') equationCount++;
  }
  spatialIndex.loadAll(bounds);
  rebuildPagesCache();
  rebuildSnapshot();
}

// Web fonts resolve after the first shapes have already been measured against
// fallback faces, and text bounds — along with their entries in the spatial
// index — are derived from those metrics. Re-derive everything once the real
// faces land, otherwise hit-testing and selection boxes stay subtly wrong for
// the life of the tab.
subscribeToTextMetrics(() => {
  if (session) fullResync();
});
watchFontLoading();

/**
 * Whether a transaction came from somewhere other than this client's own input,
 * and so may have its React publish paced to the frame — see
 * {@link publishSnapshotSoon}.
 *
 * Every origin this module writes under is a string constant, and the only
 * other origin raised from a local gesture is the page's own `Y.UndoManager`
 * (Yjs tags an undo with the manager itself). What is left is the providers:
 * Hocuspocus applying a peer's update, and the IndexedDB cache replaying the
 * page on open. A whitelist rather than a blacklist, so an origin nobody
 * anticipated keeps the immediate publish it has today.
 */
function isPaceable(origin: unknown): boolean {
  return (
    typeof origin === 'object' &&
    origin !== null &&
    !(origin instanceof Y.UndoManager)
  );
}

function makeShapesObserver(): (
  events: Y.YEvent<Y.AbstractType<unknown>>[],
) => void {
  return (events) => {
    const affected = new Set<string>();
    // One transaction raises one batch of events, so every event here shares an
    // origin; `every` reads that off the batch without assuming its length.
    const paced =
      events.length > 0 &&
      events.every((e) => isPaceable(e.transaction.origin));
    for (const e of events) {
      if (e.target === session?.currentShapes) {
        for (const key of e.keys.keys()) affected.add(key);
      } else if (typeof e.path[0] === 'string') {
        affected.add(e.path[0]);
      }
    }
    applyAffected(affected, paced);
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
  const storedPageId = readPageSession(boardId);
  session?.cleanup();
  session = null;
  // A publish still queued for the outgoing board would land after the state
  // below, describing caches this call is about to empty.
  cancelQueuedSnapshot();
  resetPageInteractionStates();
  shapeCache.clear();
  sortedShapesCache = null;
  spatialIndex.clear();
  bindingGraph.clear();
  pendingBindingDirty = null;
  parentedCount = 0;
  equationCount = 0;
  cachedPages = {};
  cachedPageOrder = [];
  cachedDoc = EMPTY_SNAPSHOT;
  useDocumentStore.setState({
    boardId,
    doc: EMPTY_SNAPSHOT,
    shapes: [],
    shapesById: shapeCache,
    hasHierarchy: false,
    hasEquations: false,
    currentPageId: DEFAULT_PAGE_ID,
  });
  useMusicPlaybackStore.getState().reset();
  useCommentsStore.getState().reset();
  useDocumentsStore.getState().reset();
  useCustomStickersStore.getState().reset();

  const doc = new Y.Doc();
  const pages = doc.getMap('pages') as Y.Map<YPageMeta>;
  const music = doc.getMap('music');
  const comments = doc.getMap<CommentMessage>('comments');
  const documents = doc.getMap<BoardDocumentMeta>('documents');
  const stickers = doc.getMap<CustomStickerMeta>('stickers');

  let restorePageFromSession = () => {};
  const pagesObserver = () => {
    if (!session) return;
    const previousOrder = [...cachedPageOrder];
    const removedPageIds = previousOrder.filter(
      (pageId) => !session!.pages.has(pageId),
    );

    // A peer deleted the page we're on — prefer its previous neighbor, matching
    // local deletion. If the old order is unavailable, use the first page.
    if (session.pages.size > 0 && !session.pages.has(session.currentPageId)) {
      const at = previousOrder.indexOf(session.currentPageId);
      const fallbackId =
        (at > 0 ? previousOrder[at - 1] : previousOrder[at + 1]) ??
        readPages(session.pages)[0]?.id;
      if (fallbackId && session.pages.has(fallbackId)) {
        switchToPageInternal(fallbackId, 'integrity');
      }
    } else {
      rebuildPagesCache();
      rebuildSnapshot();
    }

    for (const pageId of removedPageIds) {
      cleanupDeletedPageState(pageId);
    }
    restorePageFromSession();
  };
  pages.observeDeep(pagesObserver);

  const musicObserver = () => publishMusicPlayback();
  music.observe(musicObserver);
  const commentsObserver = () => publishComments();
  comments.observe(commentsObserver);
  const documentsObserver = () => publishDocuments();
  documents.observe(documentsObserver);
  const stickersObserver = () => publishCustomStickers();
  stickers.observe(stickersObserver);

  const persistence = opts.persist
    ? new IndexeddbPersistence(boardRoom(boardId), doc)
    : null;

  let socket: HocuspocusProviderWebsocket | null = null;
  let provider: HocuspocusProvider | null = null;
  let stopLatencyMonitor = () => {};
  let stopAttentionMonitor = () => {};
  let stopVoiceProvider = () => {};
  if (opts.collab) {
    // One socket for the board document and every page document on it. Each
    // provider syncs its own document over it, so opening a page adds sync
    // scope rather than another connection.
    socket = new HocuspocusProviderWebsocket({ url: collabUrl() });
    provider = new HocuspocusProvider({
      websocketProvider: socket,
      name: boardId,
      document: doc,
    });
    // A provider given a socket to share does not attach to it on its own —
    // only one that made its own socket does. Without this it connects and
    // then sits there, never syncing.
    provider.attach();
    provider.on('status', (event: { status: string }) => {
      useConnectionStore.getState().setStatus(event.status);
    });
    stopLatencyMonitor = startLatencyMonitor(provider, setLocalLatency);
    stopAttentionMonitor = startAttentionMonitor();
    stopVoiceProvider = bindVoiceProvider(provider);
    setActiveAwareness(provider.awareness ?? null);
  } else {
    useConnectionStore.getState().setStatus('disconnected');
  }

  openPageDocs({
    boardId,
    persist: Boolean(opts.persist),
    socket,
    onEvict: releasePageState,
  });

  const pageDoc = acquirePageDoc(DEFAULT_PAGE_ID);
  // The open page is never evicted from under the user.
  pinPageDoc(DEFAULT_PAGE_ID);
  const currentShapes = pageDoc.shapes;
  const undo = makeUndoManager(DEFAULT_PAGE_ID, currentShapes);
  const undoByPage = new Map([[DEFAULT_PAGE_ID, undo]]);
  const shapesObserver = makeShapesObserver();
  currentShapes.observeDeep(shapesObserver);

  session = {
    boardId,
    doc,
    pages,
    music,
    comments,
    documents,
    stickers,
    pageDoc,
    shapesDoc: pageDoc.doc,
    currentShapes,
    currentPageId: DEFAULT_PAGE_ID,
    parked: new Map(),
    pagesWithHistory: new Set(),
    socket,
    pageRestorePending: true,
    undo,
    undoByPage,
    unbindUndoState: bindUndoState(undo),
    shapesObserver,
    pagesObserver,
    musicObserver,
    commentsObserver,
    documentsObserver,
    stickersObserver,
    persistence,
    provider,
    cleanup: () => {
      stopVoiceProvider();
      cancelQueuedSnapshot();
      setActiveAwareness(null);
      session?.currentShapes.unobserveDeep(session.shapesObserver);
      pages.unobserveDeep(pagesObserver);
      music.unobserve(musicObserver);
      comments.unobserve(commentsObserver);
      documents.unobserve(documentsObserver);
      stickers.unobserve(stickersObserver);
      session?.unbindUndoState();
      for (const manager of session?.undoByPage.values() ?? []) {
        manager.destroy();
      }
      // Tears down every resident page, which releases their parked state.
      closePageDocs();
      stopLatencyMonitor();
      stopAttentionMonitor();
      provider?.destroy();
      socket?.destroy();
      persistence?.destroy();
      doc.destroy();
      useMusicPlaybackStore.getState().reset();
      useCommentsStore.getState().reset();
      useDocumentsStore.getState().reset();
      useCustomStickersStore.getState().reset();
    },
  };

  useCameraStore.getState().switchTo(boardId, DEFAULT_PAGE_ID);
  setLocalPage(DEFAULT_PAGE_ID);

  // Restore only after every configured document source has hydrated. A manual
  // switch (including a deep link) clears `pageRestorePending`, so late sync
  // events can never pull the user back to an older stored page.
  let persistenceReady = !persistence;
  let providerReady = !provider;
  restorePageFromSession = () => {
    if (
      !session ||
      session.doc !== doc ||
      !session.pageRestorePending ||
      !persistenceReady ||
      !providerReady
    ) {
      return;
    }
    const metas = readPages(session.pages);
    const targetId =
      storedPageId && session.pages.has(storedPageId)
        ? storedPageId
        : metas[0]?.id;
    if (!targetId) return;

    if (session.currentPageId !== targetId) {
      switchToPageInternal(targetId, 'restore');
    }
    if (!session || session.doc !== doc) return;
    session.pageRestorePending = false;
    writePageSession(boardId, session.currentPageId);
  };

  // Seed page-default once the board's existing state is known. We only seed
  // when the registry is still empty after sync, so a deliberately deleted
  // page-default is never resurrected (other pages keep the registry non-empty).
  // Legacy content can only be spotted once the board document has arrived, so
  // the open page is re-checked after every source syncs. A no-op once there is
  // nothing left in the legacy maps, which is every board written since.
  const migrateOpenPage = () => {
    if (session?.doc === doc) migrateLegacyPageShapes(session.currentPageId);
  };
  maybeSeedDefaultPage();
  persistence?.on('synced', maybeSeedDefaultPage);
  provider?.on('synced', maybeSeedDefaultPage);
  persistence?.on('synced', () => {
    persistenceReady = true;
    restorePageFromSession();
    migrateOpenPage();
  });
  provider?.on('synced', () => {
    providerReady = true;
    restorePageFromSession();
    migrateOpenPage();
  });
  restorePageFromSession();

  fullResync();
  migrateOpenPage();
  publishMusicPlayback();
  publishComments();
  publishDocuments();
  publishCustomStickers();

  let disposed = false;
  return () => {
    if (disposed || session?.doc !== doc) return;
    disposed = true;
    session.cleanup();
    session = null;
  };
}

/**
 * The far half of a cross-page move, hung off the undo entry that owns it.
 *
 * A move writes to two documents — shapes out of this page, shapes into the
 * target's — and a Yjs UndoManager only ever reverts its own. So only the
 * outgoing half is tracked, and the incoming half is recorded here against the
 * stack item it belongs to; {@link undo} and {@link redo} replay it by hand so
 * the two halves stay one step. Keyed on the stack item so that an entry
 * dropped from the stack takes its payload with it.
 */
interface CrossPageMove {
  targetPageId: string;
  shapes: Shape[];
}
const crossPageMoves = new WeakMap<object, CrossPageMove>();

/** Add (redo) or remove (undo) the target-page half of a recorded move. */
function replayCrossPageMove(
  move: CrossPageMove,
  direction: 'undo' | 'redo',
): void {
  const page = residentPageDoc(move.targetPageId);
  // The target is pinned resident for as long as an entry referencing it can be
  // reached, so this is only null once the board itself is gone.
  if (!page) return;
  page.doc.transact(() => {
    for (const shape of move.shapes) {
      if (direction === 'undo') page.shapes.delete(shape.id);
      else page.shapes.set(shape.id, shapeToY(shape));
    }
  }, CROSS_PAGE_ORIGIN);
}

/**
 * Undo one step, carrying the far half of a cross-page move with it.
 *
 * The stack item is read before the call and the payload re-hung on the redo
 * item after it, rather than listening for the manager's own events: Yjs emits
 * `stack-item-added` for the inverse entry *before* `stack-item-popped` for the
 * one being undone, so an event-driven handoff would have nothing to copy yet.
 */
export function undo(): void {
  if (!session) return;
  const manager = session.undo;
  const item = manager.undoStack.at(-1);
  const move = item ? crossPageMoves.get(item) : undefined;
  manager.undo();
  if (!move) return;
  replayCrossPageMove(move, 'undo');
  const inverse = manager.redoStack.at(-1);
  if (inverse) crossPageMoves.set(inverse, move);
}

/** Force the next mutation to start a new undo entry (gesture boundary). */
export function breakUndoCapture(): void {
  session?.undo.stopCapturing();
}

export function redo(): void {
  if (!session) return;
  const manager = session.undo;
  const item = manager.redoStack.at(-1);
  const move = item ? crossPageMoves.get(item) : undefined;
  manager.redo();
  if (!move) return;
  replayCrossPageMove(move, 'redo');
  const inverse = manager.undoStack.at(-1);
  if (inverse) crossPageMoves.set(inverse, move);
}

/**
 * How many edited pages stay resident for their undo history.
 *
 * History addresses the content of one document and cannot outlive it, so a
 * page the user has edited is held in memory to keep Ctrl+Z working there.
 * Bounded, because "every page visited this session" is how a long lesson ends
 * up holding the whole board again.
 */
const MAX_HISTORY_PAGES = 8;

/** Note that `pageId` now has undo history worth keeping it resident for. */
function notePageHistory(pageId: string): void {
  if (!session) return;
  const pages = session.pagesWithHistory;
  if (pages.has(pageId)) {
    // Re-insert so insertion order stays "least recently edited first".
    pages.delete(pageId);
    pages.add(pageId);
    return;
  }
  pages.add(pageId);
  pinPageDoc(pageId);
  if (pages.size > MAX_HISTORY_PAGES) {
    const oldest = pages.values().next().value;
    if (oldest !== undefined) {
      pages.delete(oldest);
      unpinPageDoc(oldest);
    }
  }
}

/** Undo history for one page, scoped to that page's own document. */
function makeUndoManager(pageId: string, map: Y.Map<YShape>): Y.UndoManager {
  const manager = new Y.UndoManager(map, {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
  });
  manager.on('stack-item-added', () => notePageHistory(pageId));
  return manager;
}

// --- Pages API ---

/**
 * Release everything hanging off a page whose document is being dropped.
 *
 * Called by the resident set when it evicts a page: the shapes that state was
 * derived from are about to leave memory, and undo history addresses the
 * content of that document, so neither can outlive it.
 */
function releasePageState(pageId: string): void {
  if (!session) return;
  discardParkedPage(pageId);
  const manager = session.undoByPage.get(pageId);
  if (manager) manager.destroy();
  session.undoByPage.delete(pageId);
  session.pagesWithHistory.delete(pageId);
}

function cleanupDeletedPageState(pageId: string): void {
  if (!session) return;
  // If the registry is temporarily empty, keep the active manager/camera alive
  // until a valid fallback arrives and the transition can complete.
  if (session.currentPageId === pageId) return;
  releasePageState(pageId);
  destroyPageDoc(pageId);
  useCameraStore.getState().deletePage(session.boardId, pageId);
  deletePageInteractionState(pageId);
}

/**
 * Move a legacy board's page content into that page's own document, once.
 *
 * Runs behind the page document's own sync so an empty page document is known
 * to be empty rather than merely unsynced. Two clients doing this at the same
 * time converge: every shape is written under the id it already had, and
 * emptying the legacy map is idempotent.
 */
function migrateLegacyPageShapes(pageId: string): void {
  if (!session) return;
  const legacy = legacyShapesMap(session.doc, pageId);
  if (!legacy || legacy.size === 0) return;
  const page = residentPageDoc(pageId);
  if (!page) return;
  const boardDoc = session.doc;
  void page.whenSynced.then(() => {
    if (!session || session.doc !== boardDoc) return;
    migrateLegacyShapes(boardDoc, legacy, page, MIGRATION_ORIGIN);
  });
}

type PageSwitchSource = 'user' | 'follow' | 'restore' | 'integrity';

/** Switch the active page as one coordinated interaction-state handoff. */
function switchToPageInternal(
  pageId: string,
  source: PageSwitchSource = 'user',
): boolean {
  if (!session || !session.pages.has(pageId)) return false;
  if (session.currentPageId === pageId) {
    if (source !== 'restore' && source !== 'integrity') {
      session.pageRestorePending = false;
      writePageSession(session.boardId, pageId);
    }
    return false;
  }

  if (source !== 'restore' && source !== 'integrity') {
    session.pageRestorePending = false;
  }
  completeInteractionBeforePageSwitch();
  if (source !== 'follow') stopFollowingForManualCameraChange();
  const previousPageId = session.currentPageId;
  leavePageInteractionState(previousPageId);
  setLocalCursor(null);

  session.currentShapes.unobserveDeep(session.shapesObserver);
  session.unbindUndoState();
  // Park before releasing the pin: the page just left is the one most likely to
  // be asked for next, and this is what makes coming back to it free.
  parkActivePage();
  unpinPageDoc(previousPageId);

  pinPageDoc(pageId);
  const page = acquirePageDoc(pageId);
  const map = page.shapes;
  session.pageDoc = page;
  session.shapesDoc = page.doc;
  session.currentShapes = map;
  session.currentPageId = pageId;
  session.shapesObserver = makeShapesObserver();
  map.observeDeep(session.shapesObserver);
  session.undo = session.undoByPage.get(pageId) ?? makeUndoManager(pageId, map);
  session.undoByPage.set(pageId, session.undo);
  session.unbindUndoState = bindUndoState(session.undo);

  useCameraStore.getState().switchTo(session.boardId, pageId);
  setLocalPage(pageId);
  // Nothing to rebuild when the page was parked intact; otherwise derive it
  // from the document, which may still be arriving — the observer publishes
  // each batch as it lands.
  if (!unparkPage(pageId)) fullResync();
  migrateLegacyPageShapes(pageId);
  enterPageInteractionState(pageId, (id) => shapeCache.get(id));
  if (source !== 'integrity' || !session.pageRestorePending) {
    writePageSession(session.boardId, pageId);
  }
  return true;
}

export function setCurrentPage(pageId: string): void {
  switchToPageInternal(pageId);
}

/** Follow mode must be able to track a tutor across pages without cancelling itself. */
export function setCurrentPageForFollow(pageId: string): void {
  switchToPageInternal(pageId, 'follow');
}

/**
 * Order index for a page inserted directly after `anchorId`, or after the last
 * page when the anchor is gone.
 */
function indexAfterPage(metas: PageMeta[], anchorId: string): string {
  const at = metas.findIndex((m) => m.id === anchorId);
  const before =
    at >= 0 ? (metas[at]?.index ?? null) : (metas.at(-1)?.index ?? null);
  const after = at >= 0 ? (metas[at + 1]?.index ?? null) : null;
  return jitterKeyBetween(before, after);
}

/** Write one page record. Must run inside a `doc.transact`. */
function putPageMeta(id: string, name: string, index: string): void {
  const m = new Y.Map<unknown>();
  m.set('id', id);
  m.set('name', name);
  m.set('index', index);
  session!.pages.set(id, m);
}

/** Create a new page after the current one and switch to it. Returns its id. */
export function createPage(name?: string): string {
  if (!session) return '';
  const id = genId();
  const metas = readPages(session.pages);
  const pageName = getIncrementedName(
    name?.trim() || `Page ${metas.length + 1}`,
    metas.map((m) => m.name),
  );
  const index = indexAfterPage(metas, session.currentPageId);
  session.doc.transact(() => {
    putPageMeta(id, pageName, index);
  });
  switchToPageInternal(id);
  return id;
}

/**
 * Copy a page and everything on it to a new page placed just after it, then
 * switch to the copy.
 *
 * Asynchronous because the source need not be the page on screen — the page
 * menu offers this on any row — and a page that is not open is not in memory.
 * Awaiting its document is the whole of the wait; when it is the open page (the
 * usual case) that resolves immediately.
 *
 * Shapes are cloned with fresh ids: the source and the copy are independent
 * pages, so sharing ids would make the two indistinguishable to anything keyed
 * by shape id (selection restore, presence, comments). `parentId` and connector
 * bindings are remapped within the copied set so frames, groups, and bound
 * arrows keep pointing at their counterparts on the new page rather than
 * reaching back across to the original.
 *
 * Resolves to the new page id, or `''` when the source page does not exist.
 */
export async function duplicatePage(id: string): Promise<string> {
  const boardDoc = session?.doc;
  if (!session || !boardDoc || !session.pages.has(id)) return '';

  pinPageDoc(id);
  try {
    const sourcePage = acquirePageDoc(id);
    migrateLegacyPageShapes(id);
    await sourcePage.whenSynced;
    // The board may have been closed or the page deleted while we waited.
    if (!session || session.doc !== boardDoc || !session.pages.has(id))
      return '';

    const metas = readPages(session.pages);
    const source = metas.find((m) => m.id === id);
    if (!source) return '';

    const newId = genId();
    const name = getIncrementedName(
      `${source.name} Copy`,
      metas.map((m) => m.name),
    );
    const index = indexAfterPage(metas, id);

    const idMap = new Map<string, string>();
    for (const shapeId of sourcePage.shapes.keys()) idMap.set(shapeId, genId());

    session.doc.transact(() => {
      putPageMeta(newId, name, index);
    });

    const target = acquirePageDoc(newId);
    target.doc.transact(() => {
      for (const [shapeId, m] of sourcePage.shapes) {
        // `clone` carries the CRDT structure across as it stands — ink point
        // chunks, text sequences, graph rows — where decoding each shape and
        // re-encoding it on the other side would rebuild all of it, and cost
        // the most on exactly the pages worth duplicating.
        const clone = m.clone();
        const cloneId = idMap.get(shapeId)!;
        // Inserted before it is patched: a clone is unintegrated until it lands
        // in a document, and reading one back before then sees nothing.
        target.shapes.set(cloneId, clone);
        clone.set('id', cloneId);
        const parentId = m.get('parentId');
        clone.set(
          'parentId',
          typeof parentId === 'string' ? (idMap.get(parentId) ?? null) : null,
        );
        remapClonedBindings(clone, idMap);
      }
    }, LOCAL_ORIGIN);

    // Land the copy on the same view of the same drawing, not at the origin.
    useCameraStore.getState().copyPage(session.boardId, id, newId);
    switchToPageInternal(newId);
    return newId;
  } finally {
    unpinPageDoc(id);
  }
}

/** One endpoint of a cloned connector, as stored in `props.bindings`. */
type StoredBinding = { shapeId: string } | null | undefined;

/**
 * Point a cloned connector's bindings at the clones of its targets. A target
 * outside `idMap` was not copied, so the binding is dropped rather than left
 * addressing a shape on another page.
 */
function remapClonedBindings(clone: YShape, idMap: Map<string, string>): void {
  if (clone.get('type') !== 'arrow') return;
  const props = clone.get('props') as
    { bindings?: { start: StoredBinding; end: StoredBinding } } | undefined;
  const bindings = props?.bindings;
  if (!bindings) return;
  const remap = (binding: StoredBinding): StoredBinding =>
    binding
      ? idMap.has(binding.shapeId)
        ? { ...binding, shapeId: idMap.get(binding.shapeId)! }
        : null
      : binding;
  clone.set('props', {
    ...props,
    bindings: { start: remap(bindings.start), end: remap(bindings.end) },
  });
}

/**
 * Move `ids` (and their descendants) from the current page to `targetPageId`,
 * keeping their ids and their world positions.
 *
 * A moved shape whose parent stays behind is re-rooted to the target page:
 * carrying a `parentId` that names a frame or group on another page would leave
 * it unreachable by the hierarchy walks. Connectors bound across the split heal
 * themselves — the routing pass nulls any binding whose target is absent from
 * the page being rendered.
 *
 * Returns the ids that were moved.
 */
export function moveShapesToPage(
  ids: string[],
  targetPageId: string,
): string[] {
  if (!session || ids.length === 0) return [];
  if (targetPageId === session.currentPageId) return [];
  if (!session.pages.has(targetPageId)) return [];

  const moving = collectSubtree(editor, ids);
  if (moving.length === 0) return [];
  const movingIds = new Set(moving.map((s) => s.id));
  const movedIds = moving.map((s) => s.id);
  const arriving = moving.map(
    (shape) =>
      ({
        ...shape,
        parentId:
          shape.parentId && movingIds.has(shape.parentId)
            ? shape.parentId
            : null,
      }) as Shape,
  );

  // Held resident for the rest of the session: undoing the move here has to
  // take the shapes back off the target, which needs its document in memory.
  pinPageDoc(targetPageId);
  const target = acquirePageDoc(targetPageId);

  // The two halves live in different documents, so they cannot be one
  // transaction. Only the outgoing half is tracked; `crossPageMoves` carries
  // the other so undo and redo move both (see `undo`). The bracketing
  // `stopCapturing` calls keep the move a step of its own rather than merging
  // with an edit made moments before or after.
  const undoManager = session.undo;
  undoManager.stopCapturing();
  const depthBefore = undoManager.undoStack.length;
  // Writing into a page that has not synced yet is safe: each shape carries the
  // id it will keep, so the write merges with whatever the page already held.
  target.doc.transact(() => {
    for (const shape of arriving) target.shapes.set(shape.id, shapeToY(shape));
  }, CROSS_PAGE_ORIGIN);
  // `movedIds`, not `ids`: `deleteShapes` does not cascade, so passing the
  // roots alone would strand their children on this page. Groups the move
  // empties out are pruned here too.
  transactLocal(() => {
    deleteShapesWithCleanup(editor, movedIds);
  });
  undoManager.stopCapturing();

  const item = undoManager.undoStack.at(-1);
  if (item && undoManager.undoStack.length > depthBefore) {
    crossPageMoves.set(item, { targetPageId, shapes: arriving });
  }

  return movedIds;
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
    const neighbor = at > 0 ? metas[at - 1] : metas[at + 1];
    if (neighbor) switchToPageInternal(neighbor.id);
  }
  const boardId = session.boardId;
  session.doc.transact(() => {
    session!.pages.delete(id);
    // A board still holding this page's shapes in the legacy map loses them
    // here too; a migrated page's content is a document of its own, dropped by
    // `cleanupDeletedPageState` as the registry change is observed.
    legacyShapesMap(session!.doc, id)?.clear();
  });
  deleteStoredPage(boardId, id);
}

/** Move a page to a resolved list position with one fractional-index write. */
export function movePageToIndex(id: string, targetIndex: number): void {
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

export function setMusicPlayback(update: {
  trackId?: string | null;
  status?: MusicPlaybackStatus;
  position?: number;
  requestedBy?: string;
}): void {
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
    session?.music.set(
      'position',
      Number.isFinite(nextPosition) ? nextPosition : 0,
    );
    session?.music.set('updatedAt', Date.now());
    session?.music.set('version', nextVersion);
    if (update.requestedBy?.trim()) {
      session?.music.set('requestedBy', update.requestedBy.trim());
    } else if ('requestedBy' in update) {
      session?.music.delete('requestedBy');
    }
  });
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

/** Whether the board's sticker library has room for another sticker. */
export function customStickersFull(): boolean {
  return (session?.stickers.size ?? 0) >= MAX_CUSTOM_STICKERS_PER_BOARD;
}

/** Publish an uploaded sticker to everyone on the board. */
export function addCustomSticker(meta: CustomStickerMeta): void {
  if (!session) return;
  session.doc.transact(() => {
    session?.stickers.set(meta.id, meta);
  }, STICKERS_ORIGIN);
}

/**
 * Remove a sticker from the board's library. Stamps already on the canvas keep
 * their artwork — they carry the blob id themselves — and the stored bytes are
 * left in place, being content-addressed and possibly shared with another board.
 */
export function removeCustomSticker(id: string): void {
  if (!session) return;
  session.doc.transact(() => {
    session?.stickers.delete(id);
  }, STICKERS_ORIGIN);
}

/**
 * Encoded size of the board document plus the open page's, in bytes.
 *
 * Every edit is retained by the CRDT, so this measures accumulated write cost,
 * not just live content — which makes it the direct way to check that drawing a
 * stroke stays linear in its point count rather than quadratic. Pages that are
 * not open are not counted: they are separate documents and not in memory.
 */
export function documentByteSize(): number {
  if (!session) return 0;
  return (
    Y.encodeStateAsUpdate(session.doc).byteLength +
    Y.encodeStateAsUpdate(session.shapesDoc).byteLength
  );
}

// --- Editor (stable; mutates the current page's Yjs map) ---

// Depth of nested local transactions currently open. While > 0 the `shapeCache`
// is stale relative to `currentShapes` (the deep observer that refreshes it only
// fires when the outermost transaction commits), so `getShape` must read the
// Yjs map directly. At depth 0 the cache is authoritative and reads are free.
let transactDepth = 0;

function transactLocal(fn: () => void): void {
  noteActivity();
  transactDepth++;
  try {
    // The active page's document: shapes live there, not in the board document.
    session?.shapesDoc.transact(fn, LOCAL_ORIGIN);
  } finally {
    transactDepth--;
  }
}

/**
 * Run shape mutations outside undo history. Yjs transactions are reentrant and
 * only the outermost one carries an origin, so the `transactLocal` calls inside
 * `editor` join this one and inherit `EPHEMERAL_ORIGIN` — which the UndoManager
 * does not track. Peers still receive the changes; only Ctrl+Z ignores them.
 *
 * For shapes that exist only for the duration of a gesture, where an undo
 * entry would be a step that undoes nothing.
 */
export function withoutUndo(fn: () => void): void {
  // No board session in unit tests — the caller's mutations still have to run.
  if (!session) {
    fn();
    return;
  }
  transactDepth++;
  try {
    session.shapesDoc.transact(fn, EPHEMERAL_ORIGIN);
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
  transact: (fn) => {
    transactLocal(fn);
  },
};
