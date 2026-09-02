import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  legacyShapesMap,
  legacyShapesMapName,
  migrateLegacyShapes,
} from './page-migration';

const ORIGIN = 'migration';

/** A board document as it was written before pages became documents. */
function legacyBoard(pageId: string, ids: string[]): Y.Doc {
  const doc = new Y.Doc();
  const shapes = doc.getMap(legacyShapesMapName(pageId)) as Y.Map<
    Y.Map<unknown>
  >;
  doc.transact(() => {
    for (const id of ids) {
      const m = new Y.Map<unknown>();
      m.set('id', id);
      m.set('type', 'draw');
      m.set('props', { color: '#000000' });
      m.set('points', Y.Array.from(['chunk-a', 'chunk-b']));
      shapes.set(id, m);
    }
  });
  return doc;
}

function pageDocument(): { doc: Y.Doc; shapes: Y.Map<Y.Map<unknown>> } {
  const doc = new Y.Doc();
  return { doc, shapes: doc.getMap('shapes') as Y.Map<Y.Map<unknown>> };
}

describe('legacyShapesMap', () => {
  it('names page-default at the root and every other page beside it', () => {
    expect(legacyShapesMapName('page-default')).toBe('shapes');
    expect(legacyShapesMapName('abc')).toBe('shapes:abc');
  });

  it('reports nothing for a board that never had a legacy map, without making one', () => {
    const doc = new Y.Doc();

    expect(legacyShapesMap(doc, 'page-default')).toBeNull();
    // Asking must not be what creates it: a board written after the split would
    // otherwise look like it had legacy content forever.
    expect(doc.share.has('shapes')).toBe(false);
  });
});

describe('migrateLegacyShapes', () => {
  it('moves a page into its own document and empties the map it came from', () => {
    const board = legacyBoard('page-default', ['a', 'b']);
    const legacy = legacyShapesMap(board, 'page-default')!;
    const page = pageDocument();

    migrateLegacyShapes(board, legacy, page, ORIGIN);

    expect([...page.shapes.keys()].sort()).toEqual(['a', 'b']);
    expect(legacy.size).toBe(0);
    // Nested CRDT structure comes across as structure, not as a re-encoding.
    const points = page.shapes.get('a')!.get('points');
    expect(points).toBeInstanceOf(Y.Array);
    expect((points as Y.Array<string>).toArray()).toEqual([
      'chunk-a',
      'chunk-b',
    ]);
  });

  it('copies rather than moves the nested types across', () => {
    const board = legacyBoard('page-default', ['a']);
    const legacy = legacyShapesMap(board, 'page-default')!;
    const original = legacy.get('a')!;
    const originalPoints = original.get('points');
    const page = pageDocument();

    migrateLegacyShapes(board, legacy, page, ORIGIN);

    // A shared type would belong to two documents at once. The copy is its own,
    // and editing it after the move stays inside the page document.
    const copied = page.shapes.get('a')!.get('points') as Y.Array<string>;
    expect(copied).not.toBe(originalPoints);
    copied.push(['chunk-c']);
    expect(copied.toArray()).toEqual(['chunk-a', 'chunk-b', 'chunk-c']);
  });

  it('runs under the origin it is given, so it is never undoable', () => {
    const board = legacyBoard('page-default', ['a']);
    const legacy = legacyShapesMap(board, 'page-default')!;
    const page = pageDocument();
    const origins: unknown[] = [];
    page.doc.on('afterTransaction', (tr: Y.Transaction) =>
      origins.push(tr.origin),
    );

    migrateLegacyShapes(board, legacy, page, ORIGIN);

    expect(origins).toEqual([ORIGIN]);
  });

  it('is a no-op the second time, and when there was nothing to move', () => {
    const board = legacyBoard('page-default', ['a']);
    const legacy = legacyShapesMap(board, 'page-default')!;
    const page = pageDocument();

    migrateLegacyShapes(board, legacy, page, ORIGIN);
    const migrated = page.shapes.get('a');
    migrateLegacyShapes(board, legacy, page, ORIGIN);

    expect(page.shapes.size).toBe(1);
    expect(page.shapes.get('a')).toBe(migrated);
  });

  it('keeps what the page already holds when both sides have a shape', () => {
    // Two clients migrating at once: the second finds the id already there and
    // must not overwrite it, so the two converge instead of fighting.
    const board = legacyBoard('page-default', ['a']);
    const legacy = legacyShapesMap(board, 'page-default')!;
    const page = pageDocument();
    const already = new Y.Map<unknown>();
    already.set('id', 'a');
    already.set('type', 'draw');
    page.shapes.set('a', already);

    migrateLegacyShapes(board, legacy, page, ORIGIN);

    expect(page.shapes.get('a')).toBe(already);
    expect(legacy.size).toBe(0);
  });
});
