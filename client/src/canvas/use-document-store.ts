import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import {
  HocuspocusProvider,
  HocuspocusProviderWebsocket,
} from '@hocuspocus/provider';
import { create } from 'zustand';
import {
  genId,
  type DrawPoint,
  type GraphExpression,
  type Page,
  type Shape,
  type WhiteboardDocument,
} from '@whiteboard/shared';
import type { Editor, ShapePatch } from './editor';
import { collectSubtree, deleteShapesWithCleanup } from './commands';
import { generateKeyBetween, jitterKeyBetween } from './order';
import {
  compactYPoints,
  encodePointsForStorage,
  ensurePointsArray,
  syncYPoints,
} from './shapes/ink-points';
import {
  encodeGraphExpressionsForStorage,
  ensureGraphExpressionsArray,
  syncYGraphExpressions,
} from './shapes/graph-storage';
import { BindingGraph } from './binding-graph';
import { SpatialIndex } from './spatial-index';
import { bindBoardRecords, deleteCommentsOnPage } from './board-records';
import { PageHistory } from './page-history';
import {
  PageDerivedState,
  collectTouchedShapeIds,
  yToShape,
  type YShape,
} from './page-derived';
import { transact } from '@tldraw/state';
import { REMOVED_MESSAGE } from '@whiteboard/shared';
import { boardKey, isViewOnly, setBoardAccess } from '@/board/board-access';
import { publishDocumentChanges } from './engine/document-changes';
import { shapeStore } from './engine/shape-store';
import {
  subscribeToTextMetrics,
  watchFontLoading,
} from './shapes/text-measure';
import { useCameraStore } from './use-camera-store';
import { useEraserCutStore } from './use-eraser-cut-store';
import { useEraserStore } from './use-eraser-store';
import { useHiddenStore } from './use-hidden-store';
import { getLiveStrokeShapeId } from './use-live-stroke-store';
import { resolveOpacity } from './opacity';
import { clearVanishing, vanishShapes } from './use-vanish-store';
import {
  beginBoardLoad,
  updateBoardLoading,
} from '@/board/use-board-loading-store';
import { useConnectionStore } from '@/collab/use-connection-store';
import { startForegroundReconnect } from '@/collab/foreground-reconnect';
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

/** The active page's derived state, built on the two singletons above. */
const derived = new PageDerivedState(spatialIndex, bindingGraph);

/**
 * Shape ids changed since the connector sync last ran, or `null` to mean "the
 * whole page changed, rescan everything" (initial load, page switch, resync).
 *
 * Accumulated rather than overwritten: React can batch several store updates
 * into one effect run, and dropping the earlier ones would leave those arrows
 * unresolved until something else happened to touch them.
 */
let pendingBindingDirty: Set<string> | null = null;
let pendingRenderDirty: Set<string> | null = null;
let pendingContentDirty = new Set<string>();
let lastRenderedCache: ReadonlyMap<string, Shape> | null = null;

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
    // Fixed-point varint chunks: see ink-points.ts.
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

/**
 * A Y.Map set is never free, even with the value it already holds: it emits a
 * new item to every peer and leaves the old one behind as a tombstone.
 */
function setIfChanged(m: YShape, key: string, value: unknown): void {
  if (m.get(key) !== value) m.set(key, value);
}

function sameProps(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && a[key] === b[key])
  );
}

function applyPatchToY(m: YShape, patch: ShapePatch): void {
  if (patch.x !== undefined) setIfChanged(m, 'x', patch.x);
  if (patch.y !== undefined) setIfChanged(m, 'y', patch.y);
  if (patch.rotation !== undefined) setIfChanged(m, 'rotation', patch.rotation);
  if (patch.index !== undefined) setIfChanged(m, 'index', patch.index);
  if (patch.parentId !== undefined) setIfChanged(m, 'parentId', patch.parentId);
  if (patch.locked !== undefined) setIfChanged(m, 'locked', patch.locked);
  if (patch.hidden !== undefined) setIfChanged(m, 'hidden', patch.hidden);
  if (patch.opacity !== undefined) setIfChanged(m, 'opacity', patch.opacity);
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
      const arr = ensurePointsArray(m);
      const points = nextProps.points as DrawPoint[];
      syncYPoints(arr, points);
      // The stroke is finished, so its per-frame chunks can be merged.
      if (nextProps.isComplete === true) compactYPoints(arr, points);
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
      // An image's blob id only ever goes from '' (upload pending) to set. A
      // gesture that began before the upload landed writes back the props it
      // snapshotted, '' included, which would strand every peer on the
      // placeholder for good.
      if (m.get('type') === 'image' && current.blobId && !merged.blobId) {
        merged.blobId = current.blobId;
        if (current.thumbBlobId && !merged.thumbBlobId)
          merged.thumbBlobId = current.thumbBlobId;
      }
      // Once a legacy shape has a Y.Text, remove its stale scalar copy.
      if (m.get('type') === 'text' && m.get('text') instanceof Y.Text) {
        delete merged.text;
      }
      if (
        m.get('type') === 'graph' &&
        m.get('expressions') instanceof Y.Array
      ) {
        delete merged.expressions;
      }
      // The live draw tool re-sends `isComplete: false` on every write; without
      // this check each one re-broadcast the whole props object.
      if (!sameProps(merged, current)) m.set('props', merged);
    }
  }
}

// --- Current board session ---

interface Session {
  boardId: string;
  doc: Y.Doc;
  /** Page registry: pageId -> { id, name, index }. */
  pages: Y.Map<YPageMeta>;
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
  /** Shared by the board document's provider and every page's, so a resident
   *  page costs sync scope rather than another socket. */
  socket: HocuspocusProviderWebsocket | null;
  /** True until stored local session state is restored or user navigation wins. */
  pageRestorePending: boolean;
  /** Undo history, per page; follows the open page. */
  history: PageHistory;
  /** Deep observer bound to `currentShapes`; swapped on page switch. */
  shapesObserver: (events: Y.YEvent<Y.AbstractType<unknown>>[]) => void;
  pagesObserver: () => void;
  persistence: IndexeddbPersistence | null;
  provider: HocuspocusProvider | null;
  cleanup: () => void;
}

let session: Session | null = null;

/**
 * Everything derived from a page that is no longer the active one.
 *
 * A page switch used to throw all of this away and rebuild it from the CRDT on
 * the way back — decode every shape, re-insert every bound into the R-tree —
 * which is the bulk of what a switch costs. Flipping between two pages is the
 * common case (a worked example on one, the exercise on the other), so the last
 * few pages keep their derived state and a switch back is a pointer swap.
 *
 * `dirty` is how that stays honest: while a page is parked its document is
 * still syncing, and a peer's edit leaves the snapshot behind. Rather than
 * apply changes to a page nobody is looking at, the watcher only notes which
 * shapes they touched, and the switch back re-derives those — so returning to
 * a page someone kept drawing on costs what they changed, not the whole page.
 */
interface ParkedPage {
  derived: PageDerivedState;
  /** Shapes edited, added or removed since the page was parked. */
  dirty: Set<string>;
  detach: () => void;
}

/** Hand the active page's derived state to `parked`, leaving the live one empty. */
function parkActivePage(): void {
  if (!session) return;
  const page = session.pageDoc;
  const entry: ParkedPage = {
    derived: new PageDerivedState(),
    dirty: new Set(),
    detach: () => {},
  };
  entry.derived.adopt(derived);

  const watcher = (events: Y.YEvent<Y.AbstractType<unknown>>[]) =>
    collectTouchedShapeIds(events, page.shapes, entry.dirty);
  page.shapes.observeDeep(watcher);
  entry.detach = () => page.shapes.unobserveDeep(watcher);

  session.parked.set(session.currentPageId, entry);
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
  if (!entry.derived.canPatch(entry.dirty.size)) return false;

  clearVanishing();
  derived.adopt(entry.derived);
  // The Canvas resolves connectors against the page it is rendering, so the
  // page coming back needs the same full rescan a freshly derived one gets.
  pendingBindingDirty = null;
  pendingRenderDirty = null;
  // No fade for what a peer deleted while the page was away: the user never
  // saw those shapes go, so a ghost would show them something that was not.
  derived.patch(session!.currentShapes, entry.dirty);
  rebuildPagesCache();
  rebuildSnapshot();
  return true;
}

interface DocStore {
  boardId: string;
  /**
   * Page metadata and order. Identity is stable across shape mutations — only
   * a change to the page registry rebuilds it — so the page menu and the board
   * chrome no longer re-render once per frame of every drag.
   */
  doc: WhiteboardDocument;
  // Shapes are not here. They are published once, into `shapeStore`, and read
  // through `use-shapes.ts` — so a shape edit notifies the readers of that
  // shape instead of every selector on this store.
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
  hasHierarchy: false,
  hasEquations: false,
  currentPageId: DEFAULT_PAGE_ID,
}));

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
  const renderDirty =
    lastRenderedCache === derived.shapes ? pendingRenderDirty : null;
  pendingRenderDirty = new Set();
  lastRenderedCache = derived.shapes;
  const contentIds = pendingContentDirty;
  pendingContentDirty = new Set();
  // One transaction: the store's atoms and the scene's derived state land
  // together, so no reaction sees a shape the scene has not ordered yet.
  transact(() => {
    const previous = shapeStore.publish(
      derived.shapes,
      renderDirty,
      derived.sortedShapes(),
    );
    publishDocumentChanges({
      shapes: derived.shapes,
      ids: renderDirty,
      contentIds,
      previous,
    });
  });
  // Everything left here changes on page and registry edits, not shape edits,
  // and zustand notifies every listener on every `setState` — so a stroke frame
  // skips it entirely rather than waking each selector to find nothing new.
  const next = {
    doc: cachedDoc,
    hasHierarchy: derived.hasHierarchy,
    hasEquations: derived.hasEquations,
    currentPageId: session.currentPageId,
  };
  const current = useDocumentStore.getState();
  if (
    current.doc !== next.doc ||
    current.hasHierarchy !== next.hasHierarchy ||
    current.hasEquations !== next.hasEquations ||
    current.currentPageId !== next.currentPageId
  )
    useDocumentStore.setState(next);
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
  const getShape = (id: string) =>
    derived.shapes.get(id) ?? removedById.get(id);
  const entries: { shape: Shape; opacity: number }[] = [];
  for (const shape of removed) {
    if (hidden[shape.id] || shape.id in cutting) continue;
    entries.push({ shape, opacity: resolveOpacity(shape, getShape, isMarked) });
  }
  vanishShapes(entries);
}

function applyAffected(ids: Set<string>, paced = false): void {
  if (!session) return;
  startVanish(derived.patch(session.currentShapes, ids));
  markBindingDirty(ids);
  if (pendingRenderDirty !== null)
    for (const id of ids) pendingRenderDirty.add(id);
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
  derived.rebuild(session.currentShapes);
  pendingBindingDirty = null;
  pendingRenderDirty = null;
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
    if (session)
      collectTouchedShapeIds(
        events,
        session.currentShapes,
        affected,
        pendingContentDirty,
      );
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
  derived.clear();
  pendingBindingDirty = null;
  pendingRenderDirty = null;
  cachedPages = {};
  cachedPageOrder = [];
  cachedDoc = EMPTY_SNAPSHOT;
  useDocumentStore.setState({
    boardId,
    doc: EMPTY_SNAPSHOT,
    hasHierarchy: false,
    hasEquations: false,
    currentPageId: DEFAULT_PAGE_ID,
  });
  shapeStore.publish(derived.shapes, null, []);
  // Mirrors the readiness flags below: a source the board does not have is a
  // source it never has to wait for. Before the collab branch, so the status it
  // sets for a board with no server is seen by the readiness subscription.
  const stopBoardLoad = beginBoardLoad({
    localSynced: !opts.persist,
    remoteSynced: !opts.collab,
  });

  const doc = new Y.Doc();
  const pages = doc.getMap('pages') as Y.Map<YPageMeta>;
  const unbindRecords = bindBoardRecords(doc);

  let restorePageFromSession = () => {};
  const pagesObserver = () => {
    if (!session) return;
    const previousOrder = [...cachedPageOrder];
    const removedPageIds = previousOrder.filter(
      (pageId) => !session!.pages.has(pageId),
    );

    // A peer deleted the page we're on — prefer its previous neighbor, matching
    // local deletion. The neighbor is only a candidate: one update can remove
    // several pages at once (a peer's deletions arrive batched), so it may be
    // gone too, in which case any surviving page will do.
    if (session.pages.size > 0 && !session.pages.has(session.currentPageId)) {
      const at = previousOrder.indexOf(session.currentPageId);
      const neighbor = at > 0 ? previousOrder[at - 1] : previousOrder[at + 1];
      const fallbackId =
        (neighbor && session.pages.has(neighbor) ? neighbor : undefined) ??
        readPages(session.pages)[0]?.id;
      // Switching rebuilds both caches itself; anything else leaves them
      // describing pages that no longer exist.
      if (!fallbackId || !switchToPageInternal(fallbackId, 'integrity')) {
        rebuildPagesCache();
        rebuildSnapshot();
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

  const persistence = opts.persist
    ? new IndexeddbPersistence(boardRoom(boardId), doc)
    : null;

  let socket: HocuspocusProviderWebsocket | null = null;
  let provider: HocuspocusProvider | null = null;
  let stopLatencyMonitor = () => {};
  let stopAttentionMonitor = () => {};
  let stopVoiceProvider = () => {};
  let stopForegroundReconnect = () => {};
  if (opts.collab) {
    // One socket for the board document and every page document on it. Each
    // provider syncs its own document over it, so opening a page adds sync
    // scope rather than another connection.
    socket = new HocuspocusProviderWebsocket({ url: collabUrl() });
    setBoardAccess('pending');
    provider = new HocuspocusProvider({
      websocketProvider: socket,
      name: boardId,
      document: doc,
      // The tutor's cookie rides the socket's upgrade; a student's link key
      // rides here. The server answers with the scope this board grants.
      token: boardKey(),
      onAuthenticated: ({ scope }) =>
        setBoardAccess(scope === 'readonly' ? 'view' : 'edit'),
      onAuthenticationFailed: () => setBoardAccess('denied'),
      onStateless: ({ payload }) => {
        if (payload === REMOVED_MESSAGE) setBoardAccess('removed');
      },
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
    stopForegroundReconnect = startForegroundReconnect(socket);
    setActiveAwareness(provider.awareness ?? null, provider);
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
  const history = new PageHistory({
    trackedOrigin: LOCAL_ORIGIN,
    pin: pinPageDoc,
    unpin: unpinPageDoc,
  });
  history.open(DEFAULT_PAGE_ID, currentShapes);
  const shapesObserver = makeShapesObserver();
  currentShapes.observeDeep(shapesObserver);

  session = {
    boardId,
    doc,
    pages,
    pageDoc,
    shapesDoc: pageDoc.doc,
    currentShapes,
    currentPageId: DEFAULT_PAGE_ID,
    parked: new Map(),
    socket,
    pageRestorePending: true,
    history,
    shapesObserver,
    pagesObserver,
    persistence,
    provider,
    cleanup: () => {
      stopVoiceProvider();
      cancelQueuedSnapshot();
      setActiveAwareness(null);
      session?.currentShapes.unobserveDeep(session.shapesObserver);
      pages.unobserveDeep(pagesObserver);
      history.destroy();
      // Tears down every resident page, which releases their parked state.
      closePageDocs();
      stopLatencyMonitor();
      stopAttentionMonitor();
      stopForegroundReconnect();
      stopBoardLoad();
      provider?.destroy();
      socket?.destroy();
      persistence?.destroy();
      doc.destroy();
      unbindRecords();
    },
  };

  useCameraStore.getState().switchTo(boardId, DEFAULT_PAGE_ID);
  setLocalPage(DEFAULT_PAGE_ID);
  trackPageSyncForLoading(pageDoc);

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
    updateBoardLoading({ pageSettled: true });
    writePageSession(boardId, session.currentPageId);
  };

  // Seed page-default once the board's existing state is known. Behind the same
  // readiness gate as the restore above, and for the same reason: before every
  // configured source has synced, an empty registry only means "nothing has
  // arrived yet". Seeding on that would resurrect a deliberately deleted
  // page-default on every board that has one — as a local write, which then
  // syncs back out to everyone. With no source to wait for (tests, in-memory
  // boards) both flags start true and this seeds immediately.
  const seedWhenSynced = () => {
    if (!session || session.doc !== doc) return;
    if (!persistenceReady || !providerReady) return;
    maybeSeedDefaultPage();
  };
  // Legacy content can only be spotted once the board document has arrived, so
  // the open page is re-checked after every source syncs. A no-op once there is
  // nothing left in the legacy maps, which is every board written since.
  const migrateOpenPage = () => {
    if (session?.doc === doc) migrateLegacyPageShapes(session.currentPageId);
  };
  persistence?.on('synced', () => {
    persistenceReady = true;
    seedWhenSynced();
    restorePageFromSession();
    migrateOpenPage();
    // Last: the restore above may have re-aimed the page the veil waits on, and
    // this is the flag that can let it lift.
    updateBoardLoading({ localSynced: true });
  });
  provider?.on('synced', () => {
    providerReady = true;
    seedWhenSynced();
    restorePageFromSession();
    migrateOpenPage();
    // Last, for the same reason as the local handler above.
    updateBoardLoading({ remoteSynced: true });
  });
  seedWhenSynced();
  restorePageFromSession();

  fullResync();
  migrateOpenPage();

  let disposed = false;
  return () => {
    if (disposed || session?.doc !== doc) return;
    disposed = true;
    session.cleanup();
    session = null;
  };
}

/** Undo one step on the open page. */
export function undo(): void {
  session?.history.undo();
}

/** Force the next mutation to start a new undo entry (gesture boundary). */
export function breakUndoCapture(): void {
  session?.history.breakCapture();
}

export function redo(): void {
  session?.history.redo();
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
  session.history.release(pageId);
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

/**
 * Tell the loading veil about the open page's document, re-armed on switch.
 *
 * A late resolve for a page that is no longer open is dropped, so switching
 * pages while one is still syncing re-aims the wait rather than deadlocking on
 * a page nobody is looking at.
 */
function trackPageSyncForLoading(page: PageDoc): void {
  updateBoardLoading({ pageSynced: page.synced });
  if (page.synced) return;
  const boardDoc = session?.doc;
  void page.whenSynced.then(() => {
    if (!session || session.doc !== boardDoc || session.pageDoc !== page) return;
    updateBoardLoading({ pageSynced: true });
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
      updateBoardLoading({ pageSettled: true });
      writePageSession(session.boardId, pageId);
    }
    return false;
  }

  if (source !== 'restore' && source !== 'integrity') {
    session.pageRestorePending = false;
    updateBoardLoading({ pageSettled: true });
  }
  completeInteractionBeforePageSwitch();
  if (source !== 'follow') stopFollowingForManualCameraChange();
  const previousPageId = session.currentPageId;
  leavePageInteractionState(previousPageId);
  setLocalCursor(null);

  session.currentShapes.unobserveDeep(session.shapesObserver);
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
  session.history.open(pageId, map);

  useCameraStore.getState().switchTo(session.boardId, pageId);
  setLocalPage(pageId);
  trackPageSyncForLoading(page);
  // Nothing to rebuild when the page was parked intact; otherwise derive it
  // from the document, which may still be arriving — the observer publishes
  // each batch as it lands.
  if (!unparkPage(pageId)) fullResync();
  migrateLegacyPageShapes(pageId);
  enterPageInteractionState(pageId, (id) => derived.shapes.get(id));
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
  if (!session || isViewOnly()) return '';
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
  if (!session || !boardDoc || !session.pages.has(id) || isViewOnly()) return '';

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
  if (!session || ids.length === 0 || isViewOnly()) return [];
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

  // The two halves live in different documents; only the outgoing one is
  // tracked, and the history replays the other so undo and redo move both.
  const replay = (direction: 'undo' | 'redo') => {
    const page = residentPageDoc(targetPageId);
    // The target is pinned resident for as long as an entry referencing it can
    // be reached, so this is only null once the board itself is gone.
    if (!page) return;
    page.doc.transact(() => {
      for (const shape of arriving) {
        if (direction === 'undo') page.shapes.delete(shape.id);
        else page.shapes.set(shape.id, shapeToY(shape));
      }
    }, CROSS_PAGE_ORIGIN);
  };
  session.history.recordMove(
    targetPageId,
    () => {
      const target = acquirePageDoc(targetPageId);
      // Writing into a page that has not synced yet is safe: each shape carries
      // the id it will keep, so the write merges with whatever the page already
      // held.
      target.doc.transact(() => {
        for (const shape of arriving)
          target.shapes.set(shape.id, shapeToY(shape));
      }, CROSS_PAGE_ORIGIN);
      // `movedIds`, not `ids`: `deleteShapes` does not cascade, so passing the
      // roots alone would strand their children on this page. Groups the move
      // empties out are pruned here too.
      transactLocal(() => {
        deleteShapesWithCleanup(editor, movedIds);
      });
    },
    replay,
  );

  return movedIds;
}

export function renamePage(id: string, name: string): void {
  if (!session || isViewOnly()) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  session.doc.transact(() => {
    const m = session!.pages.get(id);
    if (m) m.set('name', trimmed);
  });
}

export function deletePage(id: string): void {
  if (!session || isViewOnly()) return;
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
    deleteCommentsOnPage(id);
  });
  deleteStoredPage(boardId, id);
}

/** Move a page to a resolved list position with one fractional-index write. */
export function movePageToIndex(id: string, targetIndex: number): void {
  if (!session || isViewOnly()) return;
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
  if (!session || isViewOnly()) return;
  const metas = readPages(session.pages);
  const currentIndex = metas.findIndex((meta) => meta.id === id);
  if (currentIndex < 0) return;
  movePageToIndex(id, direction === 'up' ? currentIndex - 1 : currentIndex + 1);
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

// Depth of nested local transactions currently open. While > 0 the derived cache
// is stale relative to `currentShapes` (the deep observer that refreshes it only
// fires when the outermost transaction commits), so `getShape` must read the
// Yjs map directly. At depth 0 the cache is authoritative and reads are free.
let transactDepth = 0;

function transactLocal(fn: () => void): void {
  // A view-only link: the server would refuse the change, so it is never made
  // rather than shown locally and silently lost.
  if (isViewOnly()) return;
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
  if (isViewOnly()) return;
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
      const cached = derived.shapes.get(id);
      if (cached) return cached;
    }
    const m = session?.currentShapes.get(id);
    return m ? yToShape(m) : undefined;
  },
  getShapes: () => {
    if (!session) return [];
    // Served from the live shape cache (kept in sync by the Yjs observer), so
    // repeated per-gesture calls skip re-reading and re-sorting the whole map.
    return derived.sortedShapes();
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
