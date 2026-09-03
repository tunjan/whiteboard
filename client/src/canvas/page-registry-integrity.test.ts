import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

/**
 * What the client does when pages disappear out from under it.
 *
 * Locally a page is deleted one at a time, but a peer's deletions arrive
 * batched — one Yjs update, one transaction, several pages gone at once — and
 * that is the case the fallback has to survive. Reaching the board document is
 * the only way to stage it, so `Y.Doc` is subclassed to record the documents
 * the store makes; the board's is the first one.
 */
const docs: Y.Doc[] = [];
vi.mock('yjs', async () => {
  const actual = await vi.importActual<typeof import('yjs')>('yjs');
  class TrackedDoc extends actual.Doc {
    constructor(opts?: ConstructorParameters<typeof actual.Doc>[0]) {
      super(opts);
      (globalThis as unknown as { __ydocs: Y.Doc[] }).__ydocs.push(this);
    }
  }
  return { ...actual, Doc: TrackedDoc };
});
(globalThis as unknown as { __ydocs: Y.Doc[] }).__ydocs = docs;

import './shapes/register';
import {
  createPage,
  loadBoard,
  setCurrentPage,
  useDocumentStore,
} from './use-document-store';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  } as Storage;
}

/** Remove pages the way a peer's batched update does: all in one transaction. */
function removePages(...pageIds: string[]): void {
  const boardDoc = docs[0]!;
  const pages = boardDoc.getMap('pages');
  boardDoc.transact(() => {
    for (const id of pageIds) pages.delete(id);
  });
}

let dispose: () => void;
beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('sessionStorage', memoryStorage());
  docs.length = 0;
  dispose = loadBoard('test-page-integrity', { persist: false, collab: false });
});
afterEach(() => dispose());

describe('a peer deleting the open page', () => {
  it('moves to the previous page and forgets the deleted one', () => {
    const first = useDocumentStore.getState().currentPageId;
    const second = createPage('Page 2');
    const third = createPage('Page 3');
    setCurrentPage(second);

    removePages(second);

    expect(useDocumentStore.getState().currentPageId).toBe(first);
    expect(useDocumentStore.getState().doc.pageOrder).toEqual([first, third]);
  });

  it('looks past a neighbor deleted in the same update', () => {
    const first = useDocumentStore.getState().currentPageId;
    const second = createPage('Page 2');
    const third = createPage('Page 3');
    setCurrentPage(second);

    // The previous neighbor is gone too, so it is no fallback.
    removePages(first, second);

    expect(useDocumentStore.getState().currentPageId).toBe(third);
    expect(useDocumentStore.getState().doc.pageOrder).toEqual([third]);
  });
});
