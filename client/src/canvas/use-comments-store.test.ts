import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  addComment,
  addCommentReply,
  bindBoardRecords,
  deleteCommentThread,
  setThreadResolved,
} from './board-records';
import { useCommentsStore } from './use-comments-store';

const author = { name: 'Ada', color: '#ff0000' };

let dispose: () => void;
beforeEach(() => {
  dispose = bindBoardRecords(new Y.Doc());
});
afterEach(() => dispose());

describe('comments store', () => {
  it('mirrors a new thread and its reply from the Yjs comments map', () => {
    const threadId = addComment({
      pageId: 'page-default',
      x: 10,
      y: 20,
      text: 'Hello',
      author,
    });
    const replyId = addCommentReply(threadId, 'Reply', author);

    const messages = useCommentsStore.getState().messages;
    expect(messages[threadId]).toMatchObject({
      threadId,
      pageId: 'page-default',
      x: 10,
      y: 20,
      text: 'Hello',
      resolved: false,
    });
    expect(messages[replyId]).toMatchObject({
      threadId,
      pageId: 'page-default',
      text: 'Reply',
    });
  });

  it('sets the resolved flag on the thread root without touching replies', () => {
    const threadId = addComment({
      pageId: 'page-default',
      x: 0,
      y: 0,
      text: 'Hi',
      author,
    });
    const replyId = addCommentReply(threadId, 'Reply', author);

    setThreadResolved(threadId, true);

    const messages = useCommentsStore.getState().messages;
    expect(messages[threadId]?.resolved).toBe(true);
    expect(messages[replyId]?.resolved).toBeUndefined();
  });

  it('deletes a thread root and all of its replies', () => {
    const threadId = addComment({
      pageId: 'page-default',
      x: 0,
      y: 0,
      text: 'Hi',
      author,
    });
    const replyId = addCommentReply(threadId, 'Reply', author);

    deleteCommentThread(threadId);

    const messages = useCommentsStore.getState().messages;
    expect(messages[threadId]).toBeUndefined();
    expect(messages[replyId]).toBeUndefined();
  });
});
