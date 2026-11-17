import { create } from 'zustand';
import type { Bounds } from '@whiteboard/shared';

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
  /** Root only, work checker threads: the world bounds of the wrong line. */
  box?: Bounds;
  /** Root only, work checker threads: the corrected line as LaTeX. */
  correction?: string;
  /**
   * Root only, work checker threads: the shapes of the line the mistake was
   * raised on. Absent on threads from before it was recorded.
   */
  shapeIds?: string[];
  /**
   * Root only: resolved by a person — dismissed, or its correction added —
   * rather than by the checker finding the mistake gone.
   */
  dismissed?: boolean;
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
