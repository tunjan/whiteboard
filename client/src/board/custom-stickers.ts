import {
  MAX_CUSTOM_STICKERS_PER_BOARD,
  genId,
  stickerLabelFromFilename,
  type CustomStickerMeta,
} from '@whiteboard/shared';
import {
  addCustomSticker,
  customStickersFull,
} from '@/canvas/board-records';
import { useCustomStickersStore } from '@/canvas/use-custom-stickers-store';
import { useStyleStore } from '@/canvas/use-style-store';
import { useToolStore } from '@/canvas/use-tool-store';
import { getLocalUser } from '@/collab/presence';
import { uploadImageBlob } from './blobs';
import { cutOutSticker } from './remove-background';

// Client for the board's custom sticker library. A sticker is a PNG whose
// backdrop has been erased locally (see ./remove-background.ts) before upload,
// so what lands in the blob store is already the cut-out artwork — every peer
// and the PNG export get the transparency for free.

/** The cut-out re-encodes as PNG, so any raster that decodes is fair game. */
const ACCEPT = 'image/png,image/jpeg,image/webp';

const LIBRARY_FULL = `Sticker library is full (${MAX_CUSTOM_STICKERS_PER_BOARD} max)`;
const FAILED = 'Could not add that sticker';

/**
 * Cut out and publish PNG, JPEG or WebP files as board stickers. Uploads run one at a time;
 * a file that fails leaves the others alone and surfaces the last error.
 */
export async function addStickerFiles(files: File[]): Promise<void> {
  const store = useCustomStickersStore.getState();
  const addedBy = getLocalUser()?.name ?? 'Someone';
  for (const file of files) {
    if (!ACCEPT.split(',').includes(file.type)) continue;
    if (customStickersFull()) {
      store.setError(LIBRARY_FULL);
      return;
    }
    store.beginUpload();
    try {
      const art = await cutOutSticker(file);
      const blobId = await uploadImageBlob(art.blob, 'image/png');
      const id = genId();
      addCustomSticker({
        id,
        blobId,
        label: stickerLabelFromFilename(file.name),
        width: art.width,
        height: art.height,
        addedBy,
        createdAt: Date.now(),
      } satisfies CustomStickerMeta);
      // Arm what was just added: the upload was asked for to be stamped.
      useStyleStore.getState().setStickerId(id);
      useToolStore.getState().setTool('sticker');
    } catch (error) {
      console.error('[stickers] upload failed', error);
      useCustomStickersStore.getState().setError(FAILED);
    } finally {
      useCustomStickersStore.getState().endUpload();
    }
  }
}

/** Open a native file picker and add the chosen images to the board's library. */
export async function pickAndAddStickers(): Promise<void> {
  const files = await pickStickerFiles();
  if (files.length) await addStickerFiles(files);
}

/** Prompt for image files via a transient `<input type="file">`. */
function pickStickerFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = ACCEPT;
    input.multiple = true;
    input.onchange = () => resolve(input.files ? Array.from(input.files) : []);
    input.click();
  });
}
