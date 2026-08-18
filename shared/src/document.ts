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
