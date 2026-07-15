import { create } from 'zustand';

/** A single comment message. The root message of a thread (`id === threadId`)
 *  carries the pin's world position and the thread's resolved flag; replies
 *  only carry `threadId`, `pageId`, `text`, and author/timestamp fields. */
export interface CommentMessage {
  id: string;
  pageId: string;
  /** Root message id of the thread; equals `id` for the root itself. */
  threadId: string;
  /** World position — set on the root message only. */
  x?: number;
  y?: number;
  text: string;
  authorName: string;
  authorColor: string;
  createdAt: number;
  /** Root only: resolved threads are hidden. */
  resolved?: boolean;
}

interface CommentsStore {
  /** Mirror of the Yjs `comments` map, keyed by message id. */
  messages: Record<string, CommentMessage>;
  setMessages: (messages: Record<string, CommentMessage>) => void;
  /** Thread currently open in the popup, or null. Local UI state. */
  openThreadId: string | null;
  setOpenThreadId: (id: string | null) => void;
  /** Pending comment composer position (world coords), or null. Local UI state. */
  draft: { x: number; y: number } | null;
  setDraft: (draft: { x: number; y: number } | null) => void;
  reset: () => void;
}

export const useCommentsStore = create<CommentsStore>((set) => ({
  messages: {},
  setMessages: (messages) => set({ messages }),
  openThreadId: null,
  setOpenThreadId: (openThreadId) => set({ openThreadId }),
  draft: null,
  setDraft: (draft) => set({ draft }),
  reset: () => set({ messages: {}, openThreadId: null, draft: null }),
}));
