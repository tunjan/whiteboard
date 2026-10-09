import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  MAX_DOCUMENTS_PER_BOARD,
  type BoardDocumentMeta,
  type CustomStickerMeta,
} from '@whiteboard/shared';
import {
  addBoardDocument,
  addComment,
  addCommentReply,
  addCustomSticker,
  bindBoardRecords,
  boardDocumentCount,
  boardDocumentsFull,
  deleteCommentsOnPage,
  removeBoardDocument,
  removeCustomSticker,
  setMusicPlayback,
} from './board-records';
import { useCommentsStore } from './use-comments-store';
import { useCustomStickersStore } from './use-custom-stickers-store';
import { useDocumentsStore } from './use-documents-store';
import { useMusicPlaybackStore } from '@/music/use-music-playback-store';

const author = { name: 'Ada', color: '#ff0000' };
const file = (id: string) => ({ id }) as BoardDocumentMeta;
const sticker = (id: string) => ({ id }) as CustomStickerMeta;

// The board document is all these records need: no pages, no session.
let doc: Y.Doc;
let dispose: () => void;
beforeEach(() => {
  doc = new Y.Doc();
  dispose = bindBoardRecords(doc);
});
afterEach(() => dispose());

describe('board records', () => {
  it('mirrors the document repository and counts it', () => {
    addBoardDocument(file('a'));
    expect(Object.keys(useDocumentsStore.getState().documents)).toEqual(['a']);
    expect(boardDocumentCount()).toBe(1);

    removeBoardDocument('a');
    expect(useDocumentsStore.getState().documents).toEqual({});
  });

  it('says when the repository is full', () => {
    for (let i = 0; i < MAX_DOCUMENTS_PER_BOARD; i++)
      addBoardDocument(file(`d${i}`));
    expect(boardDocumentsFull()).toBe(true);
  });

  it('mirrors the sticker library', () => {
    addCustomSticker(sticker('s'));
    expect(Object.keys(useCustomStickersStore.getState().stickers)).toEqual([
      's',
    ]);
    removeCustomSticker('s');
    expect(useCustomStickersStore.getState().stickers).toEqual({});
  });

  it('versions every playback change', () => {
    setMusicPlayback({ trackId: 't', status: 'playing', position: -5 });
    setMusicPlayback({ status: 'paused' });
    const playback = useMusicPlaybackStore.getState().playback;
    expect(playback).toMatchObject({
      trackId: 't',
      status: 'paused',
      position: 0,
      version: 2,
    });
  });

  it('mirrors what a peer wrote', () => {
    const peer = new Y.Doc();
    peer.getMap('documents').set('theirs', file('theirs'));
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer));
    expect(Object.keys(useDocumentsStore.getState().documents)).toEqual([
      'theirs',
    ]);
  });

  it('drops a deleted page’s comments and keeps the rest', () => {
    const gone = addComment({ pageId: 'p1', x: 0, y: 0, text: 'a', author });
    addCommentReply(gone, 'reply', author);
    const kept = addComment({ pageId: 'p2', x: 0, y: 0, text: 'b', author });

    deleteCommentsOnPage('p1');
    expect(Object.keys(useCommentsStore.getState().messages)).toEqual([kept]);
  });

  it('empties the stores and ignores writes once unbound', () => {
    addBoardDocument(file('a'));
    dispose();
    expect(useDocumentsStore.getState().documents).toEqual({});

    addBoardDocument(file('b'));
    expect(doc.getMap('documents').has('b')).toBe(false);
  });
});
