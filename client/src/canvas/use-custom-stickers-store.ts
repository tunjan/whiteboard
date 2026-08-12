import { create } from 'zustand';
import type { CustomStickerMeta } from '@whiteboard/shared';

/**
 * The board's user-uploaded sticker library. `stickers` mirrors the Yjs
 * `stickers` map, so it is the same for everyone on the board; `pending` and
 * `error` describe this client's own cut-out/upload work and are local only.
 */
interface CustomStickersStore {
  /** Mirror of the Yjs `stickers` map, keyed by sticker id. */
  stickers: Record<string, CustomStickerMeta>;
  setStickers: (stickers: Record<string, CustomStickerMeta>) => void;
  /** Uploads in flight on this client (cut-out included). */
  pending: number;
  beginUpload: () => void;
  endUpload: () => void;
  /** Last failure, shown in the picker until the next attempt clears it. */
  error: string | null;
  setError: (error: string | null) => void;
  reset: () => void;
}

export const useCustomStickersStore = create<CustomStickersStore>((set) => ({
  stickers: {},
  setStickers: (stickers) => set({ stickers }),
  pending: 0,
  beginUpload: () => set((s) => ({ pending: s.pending + 1, error: null })),
  endUpload: () => set((s) => ({ pending: Math.max(0, s.pending - 1) })),
  error: null,
  setError: (error) => set({ error }),
  reset: () => set({ stickers: {}, pending: 0, error: null }),
}));

/** Board stickers, newest last — a stable order for the picker grid. */
export function sortedCustomStickers(
  stickers: Record<string, CustomStickerMeta>,
): CustomStickerMeta[] {
  return Object.values(stickers).sort(
    (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1),
  );
}
