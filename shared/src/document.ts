import type { Shape } from './shapes/shapes';

/**
 * A single page of a board. Shapes are keyed by id; their stacking order is
 * derived from each shape's fractional `index` (not array position) so it
 * survives concurrent CRDT edits.
 */
export interface Page {
  id: string;
  name: string;
  shapes: Record<string, Shape>;
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
