import { beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createDocumentPersistence,
  type DocumentStorage,
  type StoredDocument,
} from './document-persistence';

/** An in-memory stand-in for the two Postgres tables. */
function fakeStorage() {
  const snapshots = new Map<string, Uint8Array>();
  const logs = new Map<string, Uint8Array[]>();
  let failNextWrite = false;

  const storage: DocumentStorage = {
    async load(name): Promise<StoredDocument> {
      const snapshot = snapshots.get(name);
      return {
        snapshot: snapshot ? { data: snapshot, format: 'v2' } : undefined,
        updates: [...(logs.get(name) ?? [])],
      };
    },
    async append(name, update) {
      if (failNextWrite) {
        failNextWrite = false;
        throw new Error('append failed');
      }
      logs.set(name, [...(logs.get(name) ?? []), update]);
    },
    async compact(name, snapshot) {
      if (failNextWrite) {
        failNextWrite = false;
        throw new Error('compact failed');
      }
      snapshots.set(name, snapshot);
      logs.delete(name);
    },
  };

  return {
    storage,
    snapshots,
    logs,
    log: (name: string) => logs.get(name) ?? [],
    failNext: () => {
      failNextWrite = true;
    },
  };
}

/** Loads a fresh document from `storage` the way the server would. */
async function reload(
  persistence: ReturnType<typeof createDocumentPersistence>,
  name: string,
): Promise<Y.Doc> {
  const doc = new Y.Doc();
  await persistence.load(name, doc);
  return doc;
}

let store: ReturnType<typeof fakeStorage>;
let persistence: ReturnType<typeof createDocumentPersistence>;

beforeEach(() => {
  store = fakeStorage();
  persistence = createDocumentPersistence(store.storage);
});

describe('storing', () => {
  it('writes a delta, not the document', async () => {
    const doc = await reload(persistence, 'board');
    // A page big enough that writing all of it would be the expensive thing.
    doc.transact(() => {
      for (let i = 0; i < 2000; i++) doc.getMap('shapes').set(`s${i}`, `v${i}`);
    });
    await persistence.store('board', doc);
    doc.getMap('shapes').set('one-more', 'stroke');
    await persistence.store('board', doc);

    const [bulk, delta] = store.log('board');
    expect(delta!.byteLength).toBeLessThan(bulk!.byteLength / 100);
  });

  it('writes nothing when the document has not changed', async () => {
    const doc = await reload(persistence, 'board');
    doc.getMap('shapes').set('a', 1);
    await persistence.store('board', doc);
    await persistence.store('board', doc);

    expect(store.log('board')).toHaveLength(1);
  });

  it('merges the updates of one debounce window into a single row', async () => {
    const doc = await reload(persistence, 'board');
    const points = new Y.Array<number>();
    doc.getMap('shapes').set('stroke', points);
    for (let i = 0; i < 120; i++) points.push([i]);
    await persistence.store('board', doc);

    expect(store.log('board')).toHaveLength(1);
  });
});

describe('loading', () => {
  it('replays the snapshot and then the log', async () => {
    const doc = await reload(persistence, 'board');
    doc.getMap('shapes').set('a', 1);
    await persistence.store('board', doc);
    doc.getMap('shapes').set('b', 2);
    await persistence.store('board', doc);

    const restored = await reload(persistence, 'board');
    expect(restored.getMap('shapes').get('a')).toBe(1);
    expect(restored.getMap('shapes').get('b')).toBe(2);
  });

  it('survives a compaction in the middle of a session', async () => {
    const doc = await reload(persistence, 'board');
    // Past MAX_LOG_ROWS, so the log is folded back into the snapshot.
    for (let i = 0; i < 520; i++) {
      doc.getMap('shapes').set(`s${i}`, i);
      await persistence.store('board', doc);
    }
    doc.getMap('shapes').set('after', 'compaction');
    await persistence.store('board', doc);

    expect(store.snapshots.has('board')).toBe(true);
    expect(store.log('board').length).toBeLessThan(520);

    const restored = await reload(persistence, 'board');
    expect(restored.getMap('shapes').get('s0')).toBe(0);
    expect(restored.getMap('shapes').get('s519')).toBe(519);
    expect(restored.getMap('shapes').get('after')).toBe('compaction');
  });

  it('compacts a log already past the bound, even with nothing new to flush', async () => {
    // A log that outgrew the bound while a *previous* process held it: nothing
    // folds it back unless a store with no edits still checks the bound.
    const source = new Y.Doc();
    const rows: Uint8Array[] = [];
    source.on('updateV2', (update: Uint8Array) => rows.push(update));
    for (let i = 0; i < 520; i++) source.getMap('shapes').set(`s${i}`, i);
    store.logs.set('board', rows);

    const doc = await reload(persistence, 'board');
    await persistence.store('board', doc);

    expect(store.snapshots.has('board')).toBe(true);
    expect(store.log('board')).toHaveLength(0);

    const restored = await reload(persistence, 'board');
    expect(restored.getMap('shapes').get('s519')).toBe(519);
  });

  it('does not re-record the updates it replayed', async () => {
    const doc = await reload(persistence, 'board');
    doc.getMap('shapes').set('a', 1);
    await persistence.store('board', doc);

    const restored = await reload(persistence, 'board');
    await persistence.store('board', restored);
    expect(store.log('board')).toHaveLength(1);
  });

  it('reads a legacy v1 snapshot row', async () => {
    const legacy = new Y.Doc();
    legacy.getMap('shapes').set('a', 1);
    const raw: DocumentStorage = {
      load: async () => ({
        snapshot: { data: Y.encodeStateAsUpdate(legacy), format: 'v1' },
        updates: [],
      }),
      append: async () => {},
      compact: async () => {},
    };
    const doc = await reload(createDocumentPersistence(raw), 'board');
    expect(doc.getMap('shapes').get('a')).toBe(1);
  });
});

describe('when a write fails', () => {
  it('keeps the edits for the next store', async () => {
    const doc = await reload(persistence, 'board');
    doc.getMap('shapes').set('a', 1);
    store.failNext();
    await expect(persistence.store('board', doc)).rejects.toThrow();
    expect(store.log('board')).toHaveLength(0);

    doc.getMap('shapes').set('b', 2);
    await persistence.store('board', doc);

    const restored = await reload(persistence, 'board');
    expect(restored.getMap('shapes').get('a')).toBe(1);
    expect(restored.getMap('shapes').get('b')).toBe(2);
  });
});
