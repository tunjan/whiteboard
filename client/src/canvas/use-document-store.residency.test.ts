import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RectangleShape } from '@whiteboard/shared';

// A local cache the pages can be reloaded from, so residency limits apply —
// the main store suite runs boards with no source, where nothing is evicted.
vi.mock('y-indexeddb', () => ({
  IndexeddbPersistence: class {
    whenSynced = Promise.resolve(this);
    on(event: string, cb: () => void) {
      if (event === 'synced') cb();
    }
    destroy() {
      return Promise.resolve();
    }
    clearData() {
      return Promise.resolve();
    }
  },
}));

import './shapes/register';
import { residentPageDoc } from './page-docs';
import { createPage, deletePage, moveShapesToPage } from './page-actions';
import {
  editor,
  loadBoard,
  setCurrentPage,
  useDocumentStore,
} from './use-document-store';

function rect(id: string): RectangleShape {
  return {
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    rotation: 0,
    index: 'a1',
    props: {
      w: 10,
      h: 10,
      color: '#000000',
      fillStyle: 'none',
      dash: 'solid',
      size: 2,
    },
  };
}

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

let dispose: () => void;
beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('sessionStorage', memoryStorage());
  dispose = loadBoard('test-residency', { persist: true, collab: false });
});
afterEach(() => dispose());

describe('cross-page move residency', () => {
  /** Move a shape from the open page to a new page, then open a third. */
  function moveToNewPage(): { source: string; target: string } {
    const source = useDocumentStore.getState().currentPageId;
    const target = createPage('Target');
    setCurrentPage(source);
    editor.createShape(rect('rect-a'));
    moveShapesToPage(['rect-a'], target);
    createPage('Elsewhere');
    return { source, target };
  }

  it('holds the target while the move can still be undone', () => {
    const { target } = moveToNewPage();
    createPage('More');
    createPage('And more');
    expect(residentPageDoc(target)).toBeDefined();
  });

  it('lets the target go once the source history is gone', () => {
    const { source, target } = moveToNewPage();
    deletePage(source);
    createPage('More');
    createPage('And more');
    // Two unpinned pages resident at most, and the target is the oldest.
    expect(residentPageDoc(target)).toBeUndefined();
  });
});
