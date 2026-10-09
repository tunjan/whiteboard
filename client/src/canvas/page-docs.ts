import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import {
  HocuspocusProvider,
  HocuspocusProviderWebsocket,
} from '@hocuspocus/provider';
import { pageDocumentName } from '@whiteboard/shared';
import { boardHeaders, boardKey } from '@/board/board-access';

/**
 * The board's pages as separate CRDT documents, loaded on demand.
 *
 * A board used to be one Yjs document holding every page's shapes. Only the
 * open page was *observed*, which kept drawing cheap, but every page was still
 * decoded into memory, pulled over the socket on join and written back into one
 * database row — so opening a board cost the whole term's work, and a deleted
 * page's tombstones rode along in that row forever.
 *
 * Here each page is its own document (`pageDocumentName`), created the first
 * time the page is opened and dropped again once it falls out of the resident
 * set. Joining a board syncs the registry plus the page being looked at.
 *
 * Residency, not correctness, is what this module decides: a page that is not
 * resident is simply not in memory, and re-opening it syncs it back. Two things
 * therefore keep a page resident regardless of how long ago it was used — an
 * explicit pin from the document store (the open page, and any page holding the
 * far half of an undoable cross-page move).
 */

/** Resident pages beyond the pinned ones. Two is enough to make flipping back
 *  and forth between a pair of pages — the tutoring pattern — never re-sync. */
const MAX_RESIDENT_PAGES = 2;

export interface PageDoc {
  pageId: string;
  doc: Y.Doc;
  shapes: Y.Map<Y.Map<unknown>>;
  /** Resolves once every configured source (local cache, server) has synced,
   *  so callers can tell "this page is empty" from "this page is still coming". */
  whenSynced: Promise<void>;
  synced: boolean;
}

interface Resident extends PageDoc {
  persistence: IndexeddbPersistence | null;
  provider: HocuspocusProvider | null;
}

interface PageDocsConfig {
  boardId: string;
  persist: boolean;
  /** Shared with the board document's provider, so page documents cost extra
   *  sync scope rather than extra socket connections. */
  socket: HocuspocusProviderWebsocket | null;
  /** Called before a page's document is torn down, so the document store can
   *  release the state it hangs off that page (undo history, derived indexes). */
  onEvict: (pageId: string) => void;
}

let config: PageDocsConfig | null = null;
/** Resident pages in least-recently-used order (Map preserves insertion). */
let resident = new Map<string, Resident>();
/** Pin counts. A page with a live pin is never evicted. */
let pins = new Map<string, number>();

/** Local cache name for one page's document. */
function pageRoom(boardId: string, pageId: string): string {
  return `whiteboard:board:${pageDocumentName(boardId, pageId)}`;
}

export function openPageDocs(next: PageDocsConfig): void {
  closePageDocs();
  config = next;
}

export function closePageDocs(): void {
  const open = resident;
  resident = new Map();
  pins = new Map();
  for (const page of open.values()) tearDown(page);
  config = null;
}

function tearDown(page: Resident, clearLocalCache = false): void {
  config?.onEvict(page.pageId);
  page.provider?.destroy();
  if (clearLocalCache) {
    // Deliberately not awaited: the page is gone either way, and the store's
    // caller is synchronous.
    void page.persistence?.clearData();
  } else {
    void page.persistence?.destroy();
  }
  page.doc.destroy();
}

/**
 * Evict the least recently used unpinned pages down to the residency limit.
 *
 * Only when a dropped page can be got back. A board with neither a local cache
 * nor a server has nowhere to reload from, so its pages are its only copy and
 * every one of them stays resident.
 */
function evictExcess(): void {
  if (!config || (!config.persist && !config.socket)) return;
  // Re-counted after every eviction: tearing a page down can release pins it
  // held on others (see `onEvict`), which changes what is over the limit.
  for (let victim = excessPage(); victim; victim = excessPage()) {
    resident.delete(victim.pageId);
    tearDown(victim);
  }
}

/** The least recently used unpinned page, when there are more than allowed. */
function excessPage(): Resident | undefined {
  let removable = 0;
  let oldest: Resident | undefined;
  for (const [pageId, page] of resident) {
    if (pins.get(pageId)) continue;
    removable++;
    oldest ??= page;
  }
  return removable > MAX_RESIDENT_PAGES ? oldest : undefined;
}

/**
 * The page's document, creating and connecting it if this is its first use.
 *
 * Synchronous by design. A page's content arrives asynchronously, but nothing
 * has to wait for it: writes into a page that has not synced yet merge with
 * whatever the page already held once it does — that is what the CRDT is for —
 * so moving shapes onto a page nobody has opened this session needs no round
 * trip. Only reading a page's existing content has to await {@link whenSynced}.
 */
export function acquirePageDoc(pageId: string): PageDoc {
  const existing = resident.get(pageId);
  if (existing) {
    // Re-insert to mark it most recently used.
    resident.delete(pageId);
    resident.set(pageId, existing);
    return existing;
  }
  if (!config) {
    // No board session (unit tests construct pages without one): a bare
    // document still behaves correctly, it just never syncs anywhere.
    const doc = new Y.Doc();
    return {
      pageId,
      doc,
      shapes: doc.getMap('shapes'),
      whenSynced: Promise.resolve(),
      synced: true,
    };
  }

  const doc = new Y.Doc();
  const persistence = config.persist
    ? new IndexeddbPersistence(pageRoom(config.boardId, pageId), doc)
    : null;
  const provider = config.socket
    ? new HocuspocusProvider({
        websocketProvider: config.socket,
        name: pageDocumentName(config.boardId, pageId),
        document: doc,
        // Presence is board-level and rides the board document's provider; a
        // page provider carries document updates only.
        awareness: null,
        token: boardKey(),
      })
    : null;
  // Sharing a socket means attaching to it explicitly: a provider only does it
  // for itself when it owns the socket. `destroy` detaches again.
  provider?.attach();

  const page: Resident = {
    pageId,
    doc,
    shapes: doc.getMap('shapes'),
    persistence,
    provider,
    synced: !persistence && !provider,
    whenSynced: Promise.resolve(),
  };
  page.whenSynced = Promise.all([
    persistence ? persistence.whenSynced.then(() => {}) : Promise.resolve(),
    provider
      ? new Promise<void>((resolve) => {
          if (provider.isSynced) resolve();
          else provider.on('synced', () => resolve());
        })
      : Promise.resolve(),
  ]).then(() => {
    page.synced = true;
  });

  resident.set(pageId, page);
  evictExcess();
  return page;
}

/** The page's document if it is already resident, without making it so. */
export function residentPageDoc(pageId: string): PageDoc | undefined {
  return resident.get(pageId);
}

export function pinPageDoc(pageId: string): void {
  pins.set(pageId, (pins.get(pageId) ?? 0) + 1);
}

export function unpinPageDoc(pageId: string): void {
  const count = (pins.get(pageId) ?? 0) - 1;
  if (count > 0) pins.set(pageId, count);
  else pins.delete(pageId);
  evictExcess();
}

/** Drop a deleted page locally: its document, its pin, and its local cache.
 *  Every client runs this when the page leaves the registry. */
export function destroyPageDoc(pageId: string): void {
  pins.delete(pageId);
  const page = resident.get(pageId);
  if (!page) return;
  resident.delete(pageId);
  tearDown(page, true);
}

/**
 * Delete a page's stored content on the server.
 *
 * Only the client that deleted the page calls this — the others learn about it
 * from the registry and just drop their local copy. It goes over HTTP because
 * nothing in the Yjs protocol can say "this document no longer exists"; without
 * it the row would outlive every reference to it. Best effort: a row left
 * behind is never loaded again, so a failure costs storage, not correctness.
 */
export function deleteStoredPage(boardId: string, pageId: string): void {
  void fetch(
    `/api/pages/${encodeURIComponent(boardId)}/${encodeURIComponent(pageId)}`,
    { method: 'DELETE', credentials: 'include', headers: boardHeaders() },
  ).catch(() => {});
}
