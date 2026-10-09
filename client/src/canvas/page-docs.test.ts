import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

const persistence = vi.hoisted(() => ({ instances: [] as FakePersistence[] }));

interface FakePersistence {
  name: string;
  destroyed: boolean;
  cleared: boolean;
}

vi.mock('y-indexeddb', () => ({
  IndexeddbPersistence: class {
    name: string;
    synced = true;
    whenSynced: Promise<unknown>;
    destroyed = false;
    cleared = false;
    constructor(name: string) {
      this.name = name;
      this.whenSynced = Promise.resolve(this);
      persistence.instances.push(this as unknown as FakePersistence);
    }
    destroy(): Promise<void> {
      this.destroyed = true;
      return Promise.resolve();
    }
    clearData(): Promise<void> {
      this.cleared = true;
      return Promise.resolve();
    }
  },
}));

import {
  acquirePageDoc,
  closePageDocs,
  destroyPageDoc,
  openPageDocs,
  pinPageDoc,
  residentPageDoc,
  unpinPageDoc,
} from './page-docs';

let evicted: string[] = [];

/** A board whose pages can be reloaded, so residency limits actually apply. */
function openBoard(): void {
  openPageDocs({
    boardId: 'board-1',
    persist: true,
    socket: null,
    onEvict: (pageId) => evicted.push(pageId),
  });
}

beforeEach(() => {
  evicted = [];
  persistence.instances = [];
  openBoard();
});
afterEach(() => closePageDocs());

describe('acquirePageDoc', () => {
  it('returns the same document while the page stays resident', () => {
    const first = acquirePageDoc('p1');
    expect(acquirePageDoc('p1')).toBe(first);
    expect(first.shapes).toBe(first.doc.getMap('shapes'));
  });

  it('names the local cache after the page document', () => {
    acquirePageDoc('p1');
    expect(persistence.instances.map((p) => p.name)).toEqual([
      'whiteboard:board:board-1/pages/p1',
    ]);
  });

  it('is usable before it has synced', async () => {
    const page = acquirePageDoc('p1');
    // Writing into a page that has not synced yet is the point: the shapes
    // merge with whatever arrives, so a move never has to wait on a round trip.
    page.shapes.set('shape-a', new Y.Map<unknown>());
    await page.whenSynced;
    expect(page.synced).toBe(true);
    expect(page.shapes.has('shape-a')).toBe(true);
  });
});

describe('residency', () => {
  it('evicts the least recently used page past the limit', () => {
    const first = acquirePageDoc('p1');
    acquirePageDoc('p2');
    acquirePageDoc('p3');

    // Three unpinned pages, two allowed: the oldest goes.
    expect(evicted).toEqual(['p1']);
    expect(residentPageDoc('p1')).toBeUndefined();
    expect(residentPageDoc('p2')).toBeDefined();
    expect(first.doc.isDestroyed).toBe(true);
  });

  it('counts a re-acquired page as recently used', () => {
    acquirePageDoc('p1');
    acquirePageDoc('p2');
    acquirePageDoc('p1');
    acquirePageDoc('p3');

    expect(evicted).toEqual(['p2']);
  });

  it('never evicts a pinned page, however old', () => {
    pinPageDoc('p1');
    acquirePageDoc('p1');
    acquirePageDoc('p2');
    acquirePageDoc('p3');
    acquirePageDoc('p4');

    expect(residentPageDoc('p1')).toBeDefined();
    expect(evicted).toEqual(['p2']);
  });

  it('lets go of a page as soon as its last pin does', () => {
    pinPageDoc('p1');
    pinPageDoc('p1');
    acquirePageDoc('p1');
    acquirePageDoc('p2');
    acquirePageDoc('p3');

    unpinPageDoc('p1');
    expect(residentPageDoc('p1')).toBeDefined(); // one pin still held
    unpinPageDoc('p1');
    expect(residentPageDoc('p1')).toBeUndefined();
    expect(evicted).toEqual(['p1']);
  });

  it('evicts down to the limit when an eviction releases another pin', () => {
    // Evicting p1 lets go of p2's pin — as the document store does for the
    // target of a cross-page move — which re-enters eviction mid-pass.
    closePageDocs();
    openPageDocs({
      boardId: 'board-1',
      persist: true,
      socket: null,
      onEvict: (pageId) => {
        evicted.push(pageId);
        if (pageId === 'p1') unpinPageDoc('p2');
      },
    });
    evicted = [];
    pinPageDoc('p2');
    acquirePageDoc('p1');
    acquirePageDoc('p2');
    acquirePageDoc('p3');
    acquirePageDoc('p4');

    // p1 goes to make room; freeing p2 then makes it the oldest over the limit.
    expect(evicted).toEqual(['p1', 'p2']);
    expect(residentPageDoc('p3')).toBeDefined();
    expect(residentPageDoc('p4')).toBeDefined();
  });

  it('keeps every page when there is nowhere to reload one from', () => {
    closePageDocs();
    openPageDocs({
      boardId: 'board-1',
      persist: false,
      socket: null,
      onEvict: (pageId) => evicted.push(pageId),
    });
    evicted = [];

    acquirePageDoc('p1');
    acquirePageDoc('p2');
    acquirePageDoc('p3');
    acquirePageDoc('p4');

    expect(evicted).toEqual([]);
    expect(residentPageDoc('p1')).toBeDefined();
  });
});

describe('destroyPageDoc', () => {
  it('drops the page and wipes its local cache', () => {
    pinPageDoc('p1');
    const page = acquirePageDoc('p1');

    destroyPageDoc('p1');

    expect(residentPageDoc('p1')).toBeUndefined();
    expect(page.doc.isDestroyed).toBe(true);
    expect(persistence.instances[0]!.cleared).toBe(true);
    expect(evicted).toEqual(['p1']);
    // The pin goes with it — a deleted page must not hold residency for ever.
    acquirePageDoc('p2');
    acquirePageDoc('p3');
    acquirePageDoc('p4');
    expect(evicted).toEqual(['p1', 'p2']);
  });

  it('ignores a page that is not resident', () => {
    expect(() => destroyPageDoc('never-opened')).not.toThrow();
    expect(evicted).toEqual([]);
  });
});

describe('closePageDocs', () => {
  it('tears down every resident page', () => {
    const first = acquirePageDoc('p1');
    const second = acquirePageDoc('p2');

    closePageDocs();

    expect(evicted).toEqual(['p1', 'p2']);
    expect(first.doc.isDestroyed).toBe(true);
    expect(second.doc.isDestroyed).toBe(true);
    expect(persistence.instances.every((p) => p.destroyed)).toBe(true);
  });

  it('hands out a working document once the board is closed', () => {
    closePageDocs();
    const page = acquirePageDoc('p1');

    // No session: the page is a bare document that syncs nowhere, rather than
    // a null the callers would all have to handle.
    expect(page.synced).toBe(true);
    expect(residentPageDoc('p1')).toBeUndefined();
  });
});
