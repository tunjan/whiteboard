import * as Y from 'yjs';

/**
 * Boards written before pages became documents of their own.
 *
 * Those boards kept every page's shapes inside the board document: page-default
 * at the root map `shapes`, every other page at `shapes:<pageId>`. Nothing
 * converts them up front — a board is migrated one page at a time, the first
 * time that page is opened, so no client has to read a board in full to start
 * using it.
 */

const DEFAULT_PAGE_ID = 'page-default';

type YShape = Y.Map<unknown>;

/** Where a page's shapes sat inside the board document, before the split. */
export function legacyShapesMapName(pageId: string): string {
  return pageId === DEFAULT_PAGE_ID ? 'shapes' : `shapes:${pageId}`;
}

/**
 * A page's legacy map, or null when this board never had one.
 *
 * Consulting `share` before `getMap` is the point: `getMap` creates the type if
 * it is missing, which would plant an empty legacy map in every board document
 * written since the split — and make "does this page still need migrating?"
 * answer yes forever.
 */
export function legacyShapesMap(
  doc: Y.Doc,
  pageId: string,
): Y.Map<YShape> | null {
  const name = legacyShapesMapName(pageId);
  if (!doc.share.has(name)) return null;
  return doc.getMap(name) as Y.Map<YShape>;
}

/**
 * Move a page's legacy shapes into the page's own document, and empty the map
 * they came from.
 *
 * Idempotent, and safe for two clients to run at once: every shape keeps the id
 * it already had, so a second pass finds nothing to write and the two documents
 * converge on the same content either way.
 *
 * The caller decides *when* this is safe — the page document has to have synced
 * first, or an empty one would be indistinguishable from one that has not
 * arrived yet.
 */
export function migrateLegacyShapes(
  boardDoc: Y.Doc,
  legacy: Y.Map<YShape>,
  page: { doc: Y.Doc; shapes: Y.Map<YShape> },
  origin: unknown,
): void {
  if (legacy.size === 0) return;
  page.doc.transact(() => {
    for (const [id, m] of legacy) {
      // `clone` carries the CRDT structure straight across — ink point chunks,
      // text sequences, graph rows — rather than decoding each shape and
      // encoding it again on the other side.
      if (!page.shapes.has(id)) page.shapes.set(id, m.clone());
    }
  }, origin);
  boardDoc.transact(() => legacy.clear(), origin);
}
