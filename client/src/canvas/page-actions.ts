import * as Y from 'yjs';
import {
  genId,
  packShapeBase,
  readShapeBase,
  SHAPE_BASE_KEY,
  type Shape,
} from '@whiteboard/shared';
import { isViewOnly } from '@/board/board-access';
import { deleteCommentsOnPage } from './board-records';
import { collectSubtree, deleteShapesWithCleanup } from './commands';
import { jitterKeyBetween } from './order';
import type { YShape } from './page-derived';
import {
  acquirePageDoc,
  deleteStoredPage,
  pinPageDoc,
  residentPageDoc,
  unpinPageDoc,
} from './page-docs';
import { legacyShapesMap } from './page-migration';
import { getIncrementedName } from './page-names';
import { shapeToY } from './shape-yjs';
import { useCameraStore } from './use-camera-store';
import {
  CROSS_PAGE_ORIGIN,
  currentSession,
  editor,
  LOCAL_ORIGIN,
  migrateLegacyPageShapes,
  readPages,
  switchToPageInternal,
  type PageMeta,
  type YPageMeta,
} from './use-document-store';

// Page registry edits: create, duplicate, rename, delete, reorder, and moving
// shapes across pages. Switching pages is the board session's own business and
// stays in use-document-store.ts.

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
function putPageMeta(
  pages: Y.Map<YPageMeta>,
  id: string,
  name: string,
  index: string,
): void {
  const m = new Y.Map<unknown>();
  m.set('id', id);
  m.set('name', name);
  m.set('index', index);
  pages.set(id, m);
}

/** Create a new page after the current one and switch to it. Returns its id. */
export function createPage(name?: string): string {
  const session = currentSession();
  if (!session || isViewOnly()) return '';
  const id = genId();
  const metas = readPages(session.pages);
  const pageName = getIncrementedName(
    name?.trim() || `Page ${metas.length + 1}`,
    metas.map((m) => m.name),
  );
  const index = indexAfterPage(metas, session.currentPageId);
  session.doc.transact(() => {
    putPageMeta(session.pages, id, pageName, index);
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
  let session = currentSession();
  const boardDoc = session?.doc;
  if (!session || !boardDoc || !session.pages.has(id) || isViewOnly()) return '';

  pinPageDoc(id);
  try {
    const sourcePage = acquirePageDoc(id);
    migrateLegacyPageShapes(id);
    await sourcePage.whenSynced;
    // The board may have been closed or the page deleted while we waited.
    session = currentSession();
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

    const pages = session.pages;
    session.doc.transact(() => {
      putPageMeta(pages, newId, name, index);
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
        const base = readShapeBase(m)!;
        const parentId =
          typeof base.parentId === 'string'
            ? (idMap.get(base.parentId) ?? null)
            : null;
        clone.set(
          SHAPE_BASE_KEY,
          packShapeBase((field) =>
            field === 'id'
              ? cloneId
              : field === 'parentId'
                ? parentId
                : base[field as keyof typeof base],
          ),
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
  if (readShapeBase(clone)!.type !== 'arrow') return;
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
  const session = currentSession();
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
      editor.transact(() => {
        deleteShapesWithCleanup(editor, movedIds);
      });
    },
    replay,
  );

  return movedIds;
}

export function renamePage(id: string, name: string): void {
  const session = currentSession();
  if (!session || isViewOnly()) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  session.doc.transact(() => {
    const m = session.pages.get(id);
    if (m) m.set('name', trimmed);
  });
}

export function deletePage(id: string): void {
  const session = currentSession();
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
    session.pages.delete(id);
    // A board still holding this page's shapes in the legacy map loses them
    // here too; a migrated page's content is a document of its own, dropped by
    // `cleanupDeletedPageState` as the registry change is observed.
    legacyShapesMap(session.doc, id)?.clear();
    deleteCommentsOnPage(id);
  });
  deleteStoredPage(boardId, id);
}

/** Move a page to a resolved list position with one fractional-index write. */
export function movePageToIndex(id: string, targetIndex: number): void {
  const session = currentSession();
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
    session.pages.get(id)?.set('index', index);
  });
}

/** Move a page one slot with the same index-based operation used by dragging. */
export function movePage(id: string, direction: 'up' | 'down'): void {
  const session = currentSession();
  if (!session || isViewOnly()) return;
  const metas = readPages(session.pages);
  const currentIndex = metas.findIndex((meta) => meta.id === id);
  if (currentIndex < 0) return;
  movePageToIndex(id, direction === 'up' ? currentIndex - 1 : currentIndex + 1);
}
