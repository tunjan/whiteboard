import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardDocumentMeta } from '@whiteboard/shared';

const announced = vi.hoisted(() => [] as { description?: unknown }[]);

vi.mock('@/components/ui/toast', () => ({
  toast: {
    add: (options: { description?: unknown }) => {
      announced.push(options);
      return 'toast-id';
    },
  },
}));

import { useDocumentsStore } from '@/canvas/use-documents-store';
import {
  markDocumentOpened,
  markOwnDocument,
  startDocumentNotifications,
} from './document-notifications';

const BOARD = 'board-1';

/** Matches the stub the other storage-backed suites use. */
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

function doc(id: string, createdAt: number): BoardDocumentMeta {
  return {
    id,
    storageId: `${id}.pdf`,
    name: `${id}.pdf`,
    ext: 'pdf',
    size: 1024,
    uploadedBy: 'Robin',
    createdAt,
  };
}

/** Publish a repository snapshot the way the Yjs observer does. */
function publish(...metas: BoardDocumentMeta[]): void {
  useDocumentsStore.getState().setDocuments(
    Object.fromEntries(metas.map((meta) => [meta.id, meta])),
  );
}

function unreadIds(): string[] {
  return [...useDocumentsStore.getState().unread].sort();
}

beforeEach(() => {
  announced.length = 0;
  vi.stubGlobal('localStorage', memoryStorage());
  useDocumentsStore.getState().reset();
});

describe('document notifications', () => {
  it("announces a peer's file and leaves it unread until opened", () => {
    const stop = startDocumentNotifications(BOARD);
    publish(doc('a', Date.now() + 1_000));

    expect(announced).toHaveLength(1);
    expect(announced[0]?.description).toBe('a.pdf');
    expect(unreadIds()).toEqual(['a']);

    markDocumentOpened('a');
    expect(unreadIds()).toEqual([]);
    stop();
  });

  it('never notifies the uploader about their own file', () => {
    const stop = startDocumentNotifications(BOARD);
    // The uploader claims the id before publishing the metadata.
    markOwnDocument('mine');
    publish(doc('mine', Date.now() + 1_000));

    expect(announced).toHaveLength(0);
    expect(unreadIds()).toEqual([]);
    stop();
  });

  it('treats the backlog on a first visit as already seen', () => {
    // Otherwise the initial sync toasts every file the board has ever held.
    const stop = startDocumentNotifications(BOARD);
    publish(doc('old-1', Date.now() - 60_000), doc('old-2', Date.now() - 100));

    expect(announced).toHaveLength(0);
    expect(unreadIds()).toEqual([]);
    stop();
  });

  it('dots a file that arrived while away, without a stale toast', () => {
    // First visit establishes what this user has already seen.
    startDocumentNotifications(BOARD)();

    useDocumentsStore.getState().reset();
    const stop = startDocumentNotifications(BOARD);
    // Uploaded before this visit began — news to the user, but not live.
    publish(doc('while-away', Date.now() - 5_000));

    expect(announced).toHaveLength(0);
    expect(unreadIds()).toEqual(['while-away']);
    stop();
  });

  it('remembers what was opened across a reload', () => {
    const arrived = doc('a', Date.now() + 1_000);
    const first = startDocumentNotifications(BOARD);
    publish(arrived);
    markDocumentOpened('a');
    first();

    useDocumentsStore.getState().reset();
    const stop = startDocumentNotifications(BOARD);
    publish(arrived);

    expect(unreadIds()).toEqual([]);
    stop();
  });

  it('announces each file once, however often the map republishes', () => {
    const stop = startDocumentNotifications(BOARD);
    const arrived = doc('a', Date.now() + 1_000);
    publish(arrived);
    publish(arrived, doc('b', Date.now() + 1_000));

    expect(announced).toHaveLength(2);
    expect(unreadIds()).toEqual(['a', 'b']);
    stop();
  });

  it('forgets deleted files rather than storing their ids forever', () => {
    const stop = startDocumentNotifications(BOARD);
    publish(doc('a', Date.now() + 1_000));
    markDocumentOpened('a');
    publish();
    stop();

    expect(localStorage.getItem(`whiteboard:documents-seen:${BOARD}`)).toBe(
      '[]',
    );
  });
});
