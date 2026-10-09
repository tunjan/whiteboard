import * as Y from 'yjs';
import {
  DEFAULT_MUSIC_PLAYBACK,
  MAX_CUSTOM_STICKERS_PER_BOARD,
  MAX_DOCUMENTS_PER_BOARD,
  genId,
  type BoardDocumentMeta,
  type CustomStickerMeta,
  type MusicPlaybackState,
  type MusicPlaybackStatus,
} from '@whiteboard/shared';
import { type CommentMessage, useCommentsStore } from './use-comments-store';
import { useCustomStickersStore } from './use-custom-stickers-store';
import { useDocumentsStore } from './use-documents-store';
import { useMusicPlaybackStore } from '@/music/use-music-playback-store';

// The board document's shared records: comment threads, the document
// repository, the custom sticker library and music playback. Each is a map on
// the board document mirrored into a store of its own, and none of them is
// canvas content — they belong to the board rather than a page, and Ctrl+Z
// never touches them.
//
// The origins below predate undo being per page document; nothing tracks the
// board document any more, but they still say who wrote what.

// Comments are never part of undo history (not shapes, not selectable).
const COMMENT_ORIGIN = 'comments';
// Repository documents are board-level attachments, not canvas content, so
// Ctrl+Z never silently removes a file someone shared.
const DOCUMENTS_ORIGIN = 'documents';
// The board's custom sticker library is a shared asset, not canvas content, so
// Ctrl+Z never removes a sticker a collaborator just added.
const STICKERS_ORIGIN = 'stickers';

interface BoundRecords {
  doc: Y.Doc;
  /** Shared playback state for the board's music player. */
  music: Y.Map<unknown>;
  /** Comment thread messages, flat map keyed by message id (all pages). */
  comments: Y.Map<CommentMessage>;
  /** Board document repository metadata; the bytes live at /api/docs. */
  documents: Y.Map<BoardDocumentMeta>;
  /** The board's custom sticker library; the artwork lives at /api/blobs. */
  stickers: Y.Map<CustomStickerMeta>;
}

let bound: BoundRecords | null = null;

function resetStores(): void {
  useMusicPlaybackStore.getState().reset();
  useCommentsStore.getState().reset();
  useDocumentsStore.getState().reset();
  useCustomStickersStore.getState().reset();
}

/** Publish a flat map now and on every change to it. Returns the detach. */
function mirror<T>(
  map: Y.Map<T>,
  publish: (records: Record<string, T>) => void,
): () => void {
  const sync = () => {
    const out: Record<string, T> = {};
    for (const [id, record] of map) out[id] = record;
    publish(out);
  };
  map.observe(sync);
  sync();
  return () => map.unobserve(sync);
}

/**
 * Mirror a board document's shared records into their stores, and aim this
 * module's writes at it. Returns a disposer that detaches and empties the
 * stores again.
 */
export function bindBoardRecords(doc: Y.Doc): () => void {
  resetStores();
  const records: BoundRecords = {
    doc,
    music: doc.getMap('music'),
    comments: doc.getMap<CommentMessage>('comments'),
    documents: doc.getMap<BoardDocumentMeta>('documents'),
    stickers: doc.getMap<CustomStickerMeta>('stickers'),
  };
  bound = records;

  const publishMusic = () =>
    useMusicPlaybackStore.getState().setPlayback(readMusicPlayback());
  records.music.observe(publishMusic);
  publishMusic();
  const detach = [
    () => records.music.unobserve(publishMusic),
    mirror(records.comments, (m) => useCommentsStore.getState().setMessages(m)),
    mirror(records.documents, (d) =>
      useDocumentsStore.getState().setDocuments(d),
    ),
    mirror(records.stickers, (s) =>
      useCustomStickersStore.getState().setStickers(s),
    ),
  ];

  return () => {
    for (const fn of detach) fn();
    if (bound === records) bound = null;
    resetStores();
  };
}

// --- Music playback ---

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNonNegativeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function asMusicStatus(value: unknown): MusicPlaybackStatus {
  return value === 'playing' || value === 'paused' || value === 'stopped'
    ? value
    : DEFAULT_MUSIC_PLAYBACK.status;
}

function readMusicPlayback(): MusicPlaybackState {
  if (!bound) return DEFAULT_MUSIC_PLAYBACK;
  const { music } = bound;
  return {
    trackId: asStringOrNull(music.get('trackId')),
    status: asMusicStatus(music.get('status')),
    position: asNonNegativeNumber(music.get('position'), 0),
    updatedAt: asNonNegativeNumber(music.get('updatedAt'), 0),
    version: asNonNegativeNumber(music.get('version'), 0),
    requestedBy: asOptionalString(music.get('requestedBy')),
  };
}

export function setMusicPlayback(update: {
  trackId?: string | null;
  status?: MusicPlaybackStatus;
  position?: number;
  requestedBy?: string;
}): void {
  if (!bound) return;
  const { doc, music } = bound;
  const current = readMusicPlayback();
  const nextTrackId =
    update.trackId !== undefined ? update.trackId : current.trackId;
  const nextStatus = update.status ?? current.status;
  const nextPosition =
    update.position !== undefined
      ? Math.max(0, update.position)
      : current.position;
  const nextVersion = current.version + 1;

  doc.transact(() => {
    music.set('trackId', nextTrackId);
    music.set('status', nextStatus);
    music.set('position', Number.isFinite(nextPosition) ? nextPosition : 0);
    music.set('updatedAt', Date.now());
    music.set('version', nextVersion);
    if (update.requestedBy?.trim()) {
      music.set('requestedBy', update.requestedBy.trim());
    } else if ('requestedBy' in update) {
      music.delete('requestedBy');
    }
  });
}

// --- Comments ---
// A flat map keyed by message id: the thread root (id === threadId) carries
// the pin position and resolved flag; replies just point back via threadId.
// Concurrent replies from two clients never conflict since each is its own key.

/** Start a new comment thread pinned at a world position. Returns its id. */
export function addComment(input: {
  pageId: string;
  x: number;
  y: number;
  text: string;
  author: { name: string; color: string };
}): string {
  const id = genId();
  if (!bound) return id;
  const { doc, comments } = bound;
  const message: CommentMessage = {
    id,
    pageId: input.pageId,
    threadId: id,
    x: input.x,
    y: input.y,
    text: input.text,
    authorName: input.author.name,
    authorColor: input.author.color,
    createdAt: Date.now(),
    resolved: false,
  };
  doc.transact(() => {
    comments.set(id, message);
  }, COMMENT_ORIGIN);
  return id;
}

/** Append a reply to an existing thread. Returns the reply's id. */
export function addCommentReply(
  threadId: string,
  text: string,
  author: { name: string; color: string },
): string {
  const id = genId();
  if (!bound) return id;
  const { doc, comments } = bound;
  const root = comments.get(threadId);
  if (!root) return id;
  const message: CommentMessage = {
    id,
    pageId: root.pageId,
    threadId,
    text,
    authorName: author.name,
    authorColor: author.color,
    createdAt: Date.now(),
  };
  doc.transact(() => {
    comments.set(id, message);
  }, COMMENT_ORIGIN);
  return id;
}

/** Mark a thread resolved/unresolved. Resolved threads are hidden on canvas. */
export function setThreadResolved(threadId: string, resolved: boolean): void {
  if (!bound) return;
  const { doc, comments } = bound;
  const root = comments.get(threadId);
  if (!root) return;
  doc.transact(() => {
    comments.set(threadId, { ...root, resolved });
  }, COMMENT_ORIGIN);
}

/** Delete a thread's root message and all of its replies. */
export function deleteCommentThread(threadId: string): void {
  if (!bound) return;
  const { doc, comments } = bound;
  doc.transact(() => {
    for (const [id, message] of comments) {
      if (message.threadId === threadId) comments.delete(id);
    }
  }, COMMENT_ORIGIN);
}

/**
 * Drop every comment pinned to a page that is being deleted. Comments live on
 * the board document, not the page's, so nothing else drops them: left behind
 * they would sync to every client on every join, for a page no view can ever
 * show again. Joins the caller's transaction.
 */
export function deleteCommentsOnPage(pageId: string): void {
  if (!bound) return;
  const { comments } = bound;
  for (const [id, message] of comments) {
    if (message.pageId === pageId) comments.delete(id);
  }
}

// --- Document repository ---

/** How many documents the board's repository currently holds. */
export function boardDocumentCount(): number {
  return bound?.documents.size ?? 0;
}

/** Whether the repository has room for another document. */
export function boardDocumentsFull(): boolean {
  return boardDocumentCount() >= MAX_DOCUMENTS_PER_BOARD;
}

/** Publish an uploaded document to everyone on the board. */
export function addBoardDocument(meta: BoardDocumentMeta): void {
  if (!bound) return;
  const { doc, documents } = bound;
  doc.transact(() => {
    documents.set(meta.id, meta);
  }, DOCUMENTS_ORIGIN);
}

/** Remove a document from the board. The stored bytes are left in place —
 *  they're content-addressed and may be shared with another board. */
export function removeBoardDocument(id: string): void {
  if (!bound) return;
  const { doc, documents } = bound;
  doc.transact(() => {
    documents.delete(id);
  }, DOCUMENTS_ORIGIN);
}

// --- Custom stickers ---

/** Whether the board's sticker library has room for another sticker. */
export function customStickersFull(): boolean {
  return (bound?.stickers.size ?? 0) >= MAX_CUSTOM_STICKERS_PER_BOARD;
}

/** Publish an uploaded sticker to everyone on the board. */
export function addCustomSticker(meta: CustomStickerMeta): void {
  if (!bound) return;
  const { doc, stickers } = bound;
  doc.transact(() => {
    stickers.set(meta.id, meta);
  }, STICKERS_ORIGIN);
}

/**
 * Remove a sticker from the board's library. Stamps already on the canvas keep
 * their artwork — they carry the blob id themselves — and the stored bytes are
 * left in place, being content-addressed and possibly shared with another board.
 */
export function removeCustomSticker(id: string): void {
  if (!bound) return;
  const { doc, stickers } = bound;
  doc.transact(() => {
    stickers.delete(id);
  }, STICKERS_ORIGIN);
}
