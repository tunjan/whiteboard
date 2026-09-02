/**
 * A single page of a board.
 *
 * Deliberately metadata only. A page's shapes used to hang here as a
 * `Record<string, Shape>`, which meant the store had to copy every shape on the
 * page into a fresh object on every mutation just to publish a snapshot —
 * O(n) per frame of every drag, to serve consumers that only ever looked one
 * shape up by id. The store exposes `shapesById` for that, and z-order comes
 * from each shape's fractional `index` (not array position) so it survives
 * concurrent CRDT edits.
 */
export interface Page {
  id: string;
  name: string;
}

/**
 * The board document content. This is the shape that lives in the Yjs doc
 * (Phase 14+). The UI ships single-page, but the model is multi-page-ready so a
 * page switcher drops in later.
 *
 * Camera/viewport is intentionally NOT stored here — it is per-user, local
 * state (see the client camera store).
 */
export interface WhiteboardDocument {
  pages: Record<string, Page>;
  pageOrder: string[];
}

/**
 * Collaboration document name for one page's shapes.
 *
 * A board is not one CRDT document but a small tree of them: the board's own
 * document holds the page registry, comments, repository documents, stickers
 * and music, and each page's shapes live in a document of their own. That is
 * what makes a page loadable on demand — joining a 40-page board syncs the
 * registry and the one page being looked at, not the other 39 — and what makes
 * a deleted page's content actually reclaimable, since the whole document goes
 * rather than leaving tombstones inside the board's.
 *
 * Both halves of the system derive the name from here: the client names its
 * providers with it, and the server persists one row per name.
 */
export function pageDocumentName(boardId: string, pageId: string): string {
  return `${boardId}${PAGE_DOCUMENT_INFIX}${pageId}`;
}

/** Separates the board id from the page id in a page document name. */
export const PAGE_DOCUMENT_INFIX = '/pages/';

/** Prefix every page document of `boardId` starts with. */
export function pageDocumentPrefix(boardId: string): string {
  return `${boardId}${PAGE_DOCUMENT_INFIX}`;
}
