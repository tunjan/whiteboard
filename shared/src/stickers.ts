/**
 * Metadata for one user-uploaded sticker in a board's sticker library. This
 * lives in the Yjs doc (so it syncs live to every peer on the board); the
 * cut-out PNG bytes live in the image blob store at `/api/blobs/<blobId>`.
 *
 * The library is board-scoped and shared: anyone on the board can add a
 * sticker, and everyone can stamp it. `addedBy` is attribution only.
 */
export interface CustomStickerMeta {
  /** Client-minted via genId(); the key in the Yjs `stickers` map. */
  id: string;
  /** `<sha256>.png` from the blob upload — the background-removed artwork. */
  blobId: string;
  /** Shown in the picker's tooltip/label. Derived from the filename. */
  label: string;
  /** Pixel size of the cut-out, so a stamp lands at the artwork's aspect. */
  width: number;
  height: number;
  /** Display-only attribution (the uploader's presence name). */
  addedBy: string;
  createdAt: number;
}

/** Guards against a stray multi-file drop filling a board's picker. */
export const MAX_CUSTOM_STICKERS_PER_BOARD = 48;

/**
 * Longest edge (px) a sticker's artwork is downscaled to before the cut-out.
 * Stickers are stamped at ~96 world units, so anything beyond this is paying
 * upload and sync cost for pixels no one sees.
 */
export const CUSTOM_STICKER_MAX_PX = 512;

/** Labels are a tooltip, not a filename — long ones are truncated to this. */
export const MAX_STICKER_LABEL_LENGTH = 40;

/** Longest description accepted by `POST /api/ai/sticker`. */
export const MAX_STICKER_PROMPT_CHARS = 200;

export interface StickerImageResponse {
  /** PNG, JPEG or WebP data URL of the generated artwork, backdrop and all. */
  image: string;
}

/** A filename turned into a sticker label: drop the extension, tidy separators. */
export function stickerLabelFromFilename(filename: string): string {
  const dot = filename.lastIndexOf('.');
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const label = stem.replaceAll(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!label) return 'Sticker';
  return label.length > MAX_STICKER_LABEL_LENGTH
    ? `${label.slice(0, MAX_STICKER_LABEL_LENGTH - 1).trimEnd()}…`
    : label;
}
