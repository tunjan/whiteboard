import { create } from 'zustand';

/** Must match the `sticker-pop` keyframe duration in index.css. */
const POP_MS = 260;

interface StickerPopStore {
  /** Stickers stamped in the last {@link POP_MS} ms, by shape id. */
  popping: ReadonlySet<string>;
  pop: (id: string) => void;
}

/**
 * Marks a freshly stamped sticker so it can play its entrance animation once.
 *
 * The flag lives outside the document rather than on the shape: the pop is a
 * local, transient reaction to *this* user's click, so it must not sync to
 * peers, land in the undo stack, or replay when the board is reopened. Ids drop
 * out on a timer, which is also what keeps a burst of rapid stamps from cutting
 * each other's animation short.
 */
export const useStickerPopStore = create<StickerPopStore>((set) => ({
  popping: new Set<string>(),

  pop: (id) => {
    set((s) => ({ popping: new Set(s.popping).add(id) }));
    setTimeout(() => {
      set((s) => {
        if (!s.popping.has(id)) return s;
        const next = new Set(s.popping);
        next.delete(id);
        return { popping: next };
      });
    }, POP_MS);
  },
}));
