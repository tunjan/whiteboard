import { create } from 'zustand';
import type { CustomStickerMeta } from '@whiteboard/shared';
import type { CutOutOptions } from '@/board/remove-background';

/** An upload waiting on the user to settle how its backdrop is cut out. */
export interface StickerReview {
  fileName: string;
  /** Decoded, downscaled pixels, before any cut-out. */
  source: ImageData;
  settle: (options: CutOutOptions | null) => void;
}

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
  /** The upload the cut-out dialog is showing, if any. */
  review: StickerReview | null;
  /** Answer the open review. `null` skips that file. */
  settleReview: (options: CutOutOptions | null) => void;
  reset: () => void;
}

export const useCustomStickersStore = create<CustomStickersStore>((set, get) => ({
  stickers: {},
  setStickers: (stickers) => set({ stickers }),
  pending: 0,
  beginUpload: () => set((s) => ({ pending: s.pending + 1, error: null })),
  endUpload: () => set((s) => ({ pending: Math.max(0, s.pending - 1) })),
  error: null,
  setError: (error) => set({ error }),
  review: null,
  settleReview: (options) => {
    const { review } = get();
    if (!review) return;
    set({ review: null });
    review.settle(options);
  },
  reset: () => set({ stickers: {}, pending: 0, error: null }),
}));

/**
 * Ask how to cut out one upload, and wait for the answer — the same
 * promise-driven pattern as `requestPageRange`, settled by
 * `<StickerCutOutDialog />`. Resolves `null` when the user cancels.
 */
export function requestStickerCutOut(
  fileName: string,
  source: ImageData,
): Promise<CutOutOptions | null> {
  return new Promise((settle) => {
    useCustomStickersStore.getState().review?.settle(null);
    useCustomStickersStore.setState({ review: { fileName, source, settle } });
  });
}

/** Board stickers, newest last — a stable order for the picker grid. */
export function sortedCustomStickers(
  stickers: Record<string, CustomStickerMeta>,
): CustomStickerMeta[] {
  return Object.values(stickers).sort(
    (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1),
  );
}
