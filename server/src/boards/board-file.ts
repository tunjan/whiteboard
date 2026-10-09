import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { gunzip, gzip } from 'node:zlib';
import * as Y from 'yjs';
import { MAX_DOCUMENT_BYTES, pageDocumentName } from '@whiteboard/shared';
import {
  MAX_BLOB_BYTES,
  isValidBlobId,
  mimeForBlobId,
  readBlob,
  saveBlob,
} from '../blobs/store';
import { extForDocId, isValidDocId, readDoc, saveDoc } from '../documents/store';
import { postgresDocumentStorage } from '../collab/document-persistence';
import { migrateShapes } from '../collab/migrate-shapes';
import { hocuspocus } from '../collab/hocuspocus';

/**
 * The `.board` file: a whole board — every page, the board-level records, and
 * the bytes of every image, sticker and file it references — in one download
 * that imports back as a new board, on this server or another one.
 *
 * Gzipped JSON. Yjs states are V2 updates and assets their raw bytes, both
 * base64. Base64 of already-compressed images gzips back to roughly its raw
 * size, so this costs little over a binary container and stays inspectable
 * with `gunzip | jq`.
 *
 * Asset ids are content hashes, so re-uploading an asset's bytes reproduces its
 * id and nothing inside the Yjs states needs rewriting on import.
 */
export interface BoardFile {
  format: typeof FORMAT;
  version: typeof VERSION;
  name: string;
  /** The board document (page registry, comments, files, stickers, music). */
  board: string;
  /** Page id → that page's document. */
  pages: Record<string, string>;
  /** Image blob id → bytes. */
  blobs: Record<string, string>;
  /** Document-repository storage id → bytes. */
  files: Record<string, string>;
}

const FORMAT = 'whiteboard-board';
const VERSION = 1;

// ponytail: the whole file is one JSON string in memory, so V8's ~512 MB string
// limit is the ceiling; move to a streamed binary container if boards get there.
const MAX_FILE_BYTES = 512 * 1024 * 1024;

export class BoardFileError extends Error {}

export async function packBoardFile(file: BoardFile): Promise<Buffer> {
  return promisify(gzip)(JSON.stringify(file));
}

export async function unpackBoardFile(bytes: Uint8Array): Promise<BoardFile> {
  let file: BoardFile;
  try {
    const json = await promisify(gunzip)(bytes, {
      maxOutputLength: MAX_FILE_BYTES,
    });
    file = JSON.parse(json.toString('utf8'));
  } catch {
    throw new BoardFileError('Not a board file');
  }
  if (file?.format !== FORMAT) throw new BoardFileError('Not a board file');
  if (file.version !== VERSION) {
    throw new BoardFileError(`Unsupported board file version ${file.version}`);
  }
  const isRecord = (v: unknown) =>
    typeof v === 'object' && v !== null && !Array.isArray(v);
  if (
    typeof file.name !== 'string' ||
    typeof file.board !== 'string' ||
    !isRecord(file.pages) ||
    !isRecord(file.blobs) ||
    !isRecord(file.files)
  ) {
    throw new BoardFileError('Malformed board file');
  }
  return file;
}

/**
 * Every asset a document references. Image ids sit under `blobId`,
 * `thumbBlobId`, `imageBlobId`, … — any key ending in `blobId` — and file ids
 * under `storageId`. Every top-level type in these documents is a map.
 */
export function collectAssetIds(
  doc: Y.Doc,
  into: { blobs: Set<string>; files: Set<string> },
): void {
  const walk = (value: unknown, key: string) => {
    if (typeof value === 'string') {
      if (key === 'storageId' && isValidDocId(value)) into.files.add(value);
      else if (/blobid$/i.test(key) && isValidBlobId(value)) {
        into.blobs.add(value);
      }
    } else if (value && typeof value === 'object' && !ArrayBuffer.isView(value)) {
      // Ink points are byte arrays; walking them key by key would be slow.
      for (const [k, v] of Object.entries(value)) walk(v, k);
    }
  };
  for (const name of [...doc.share.keys()]) walk(doc.getMap(name).toJSON(), name);
}

/** A document as it is right now: the live copy if anyone has it open. */
async function currentDocument(documentName: string): Promise<Y.Doc> {
  const live = hocuspocus.documents.get(documentName);
  if (live) return live;
  const doc = new Y.Doc();
  const { snapshot, updates } = await postgresDocumentStorage.load(documentName);
  doc.transact(() => {
    if (snapshot?.format === 'v2') Y.applyUpdateV2(doc, snapshot.data);
    else if (snapshot) Y.applyUpdate(doc, snapshot.data);
    for (const update of updates) Y.applyUpdateV2(doc, update);
  });
  return doc;
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

export async function exportBoard(boardId: string, name: string): Promise<Buffer> {
  const board = await currentDocument(boardId);
  const assets = { blobs: new Set<string>(), files: new Set<string>() };
  collectAssetIds(board, assets);

  const pages: Record<string, string> = {};
  // The registry, not the stored rows: a page document can outlive its page.
  for (const pageId of board.getMap('pages').keys()) {
    const page = await currentDocument(pageDocumentName(boardId, pageId));
    collectAssetIds(page, assets);
    pages[pageId] = b64(Y.encodeStateAsUpdateV2(page));
  }

  const blobs: Record<string, string> = {};
  for (const id of assets.blobs) {
    const bytes = await readBlob(id);
    if (bytes) blobs[id] = b64(bytes);
  }
  const files: Record<string, string> = {};
  for (const id of assets.files) {
    const bytes = await readDoc(id);
    if (bytes) files[id] = b64(bytes);
  }

  return packBoardFile({
    format: FORMAT,
    version: VERSION,
    name,
    board: b64(Y.encodeStateAsUpdateV2(board)),
    pages,
    blobs,
    files,
  });
}

/** Decodes a V2 update into a fresh document, rejecting anything Yjs can't read. */
function decodeDocument(base64: unknown): Y.Doc {
  if (typeof base64 !== 'string') throw new BoardFileError('Malformed board file');
  const doc = new Y.Doc();
  try {
    Y.applyUpdateV2(doc, Buffer.from(base64, 'base64'));
  } catch {
    throw new BoardFileError('Malformed board file');
  }
  // A file exported before shapes were packed.
  migrateShapes(doc);
  return doc;
}

/**
 * Writes a board file's contents under `boardId`. Everything is decoded and
 * checked before the first write, so a bad file stores nothing; the caller
 * creates the board row last, so a failure midway is never a visible board.
 */
export async function importBoard(boardId: string, file: BoardFile): Promise<void> {
  const board = decodeDocument(file.board);
  const pages = new Map<string, Y.Doc>();
  // Only pages the registry names: a file can't plant documents elsewhere.
  for (const pageId of board.getMap('pages').keys()) {
    if (pageId in file.pages) pages.set(pageId, decodeDocument(file.pages[pageId]));
  }

  const assets = (
    entries: Record<string, unknown>,
    valid: (id: string) => boolean,
    max: number,
  ) =>
    Object.entries(entries).map(([id, data]) => {
      if (!valid(id) || typeof data !== 'string') {
        throw new BoardFileError('Malformed board file');
      }
      const bytes = Buffer.from(data, 'base64');
      if (bytes.byteLength === 0 || bytes.byteLength > max) {
        throw new BoardFileError('Malformed board file');
      }
      // Ids are content hashes: bytes that don't hash to their id aren't the
      // asset the board refers to.
      if (createHash('sha256').update(bytes).digest('hex') !== id.split('.')[0]) {
        throw new BoardFileError('Corrupt asset in board file');
      }
      return { id, bytes };
    });
  const blobs = assets(file.blobs, isValidBlobId, MAX_BLOB_BYTES);
  const files = assets(file.files, isValidDocId, MAX_DOCUMENT_BYTES);

  for (const { id, bytes } of blobs) await saveBlob(bytes, mimeForBlobId(id)!);
  for (const { id, bytes } of files) await saveDoc(bytes, extForDocId(id));

  await postgresDocumentStorage.compact(boardId, Y.encodeStateAsUpdateV2(board));
  for (const [pageId, page] of pages) {
    await postgresDocumentStorage.compact(
      pageDocumentName(boardId, pageId),
      Y.encodeStateAsUpdateV2(page),
    );
  }
}
