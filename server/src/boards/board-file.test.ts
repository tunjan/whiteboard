import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

/**
 * Export → import round trip against real blob/document stores (in a temp dir)
 * and an in-memory document store, plus the rejections that guard the import.
 */

const stored = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? '/tmp'}/board-file-test-${process.pid}`;
  process.env.BLOB_DIR = `${dir}/blobs`;
  process.env.DOC_DIR = `${dir}/docs`;
  return new Map<string, Uint8Array>();
});

vi.mock('../collab/hocuspocus', () => ({
  hocuspocus: { documents: new Map() },
}));
vi.mock('../collab/document-persistence', () => ({
  postgresDocumentStorage: {
    load: async (name: string) => ({
      snapshot: stored.has(name)
        ? { data: stored.get(name)!, format: 'v2' }
        : undefined,
      updates: [],
    }),
    compact: async (name: string, data: Uint8Array) => {
      stored.set(name, data);
    },
  },
}));

import { saveBlob } from '../blobs/store';
import { saveDoc } from '../documents/store';
import {
  BoardFileError,
  exportBoard,
  importBoard,
  packBoardFile,
  unpackBoardFile,
} from './board-file';

const png = Buffer.from('fake png bytes');
const pdf = Buffer.from('%PDF fake');

async function seedBoard() {
  const blobId = await saveBlob(png, 'image/png');
  const storageId = await saveDoc(pdf, 'pdf');
  const board = new Y.Doc();
  board.getMap('pages').set('p1', { id: 'p1', name: 'Page 1', index: 'a0' });
  board.getMap('documents').set('d1', { id: 'd1', storageId, name: 'a.pdf' });
  const page = new Y.Doc();
  const shape = new Y.Map();
  shape.set('props', { blobId, w: 10 });
  page.getMap('shapes').set('s1', shape);
  stored.set('src', Y.encodeStateAsUpdateV2(board));
  stored.set('src/pages/p1', Y.encodeStateAsUpdateV2(page));
  // A deleted page's leftover row is not part of the board.
  stored.set('src/pages/gone', Y.encodeStateAsUpdateV2(new Y.Doc()));
  return { blobId, storageId };
}

describe('board file', () => {
  it('round-trips pages, records and assets into a new board', async () => {
    const { blobId, storageId } = await seedBoard();
    const file = await unpackBoardFile(await exportBoard('src', 'Algebra'));

    expect(file.name).toBe('Algebra');
    expect(Object.keys(file.pages)).toEqual(['p1']);
    expect(Buffer.from(file.blobs[blobId]!, 'base64')).toEqual(png);
    expect(Buffer.from(file.files[storageId]!, 'base64')).toEqual(pdf);

    await importBoard('dst', file);
    const page = new Y.Doc();
    Y.applyUpdateV2(page, stored.get('dst/pages/p1')!);
    expect(page.getMap('shapes').get('s1')).toBeInstanceOf(Y.Map);
    expect((page.getMap('shapes').get('s1') as Y.Map<unknown>).get('props'))
      .toEqual({ blobId, w: 10 });
    const board = new Y.Doc();
    Y.applyUpdateV2(board, stored.get('dst')!);
    expect(board.getMap('documents').get('d1')).toMatchObject({ storageId });
  });

  it('rejects files that are not board files', async () => {
    await expect(unpackBoardFile(Buffer.from('nope'))).rejects.toThrow(
      BoardFileError,
    );
    const wrong = await packBoardFile({ format: 'other' } as never);
    await expect(unpackBoardFile(wrong)).rejects.toThrow(BoardFileError);
  });

  it('rejects an asset whose bytes do not match its id, before writing', async () => {
    const id = `${createHash('sha256').update('real').digest('hex')}.png`;
    stored.clear();
    const file = {
      format: 'whiteboard-board' as const,
      version: 1 as const,
      name: 'x',
      board: Buffer.from(Y.encodeStateAsUpdateV2(new Y.Doc())).toString('base64'),
      pages: {},
      blobs: { [id]: Buffer.from('tampered').toString('base64') },
      files: {},
    };
    await expect(importBoard('bad', file)).rejects.toThrow(BoardFileError);
    expect(stored.has('bad')).toBe(false);
  });
});
