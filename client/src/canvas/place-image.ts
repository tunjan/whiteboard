import { genId, type Point, type Shape } from '@whiteboard/shared';
import { uploadImageFile } from '../board/blobs';
import { screenToWorld } from './camera';
import { getTopIndex } from './order';
import { useCameraStore } from './use-camera-store';
import { editor } from './use-document-store';
import { useSelectionStore } from './use-selection-store';
import { useToolStore } from './use-tool-store';

/** Largest dimension (world units) a freshly-placed image is fit to. */
const MAX_PLACE = 600;

/** Image types accepted by the picker (mirrors the server allow-list). */
const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';

/**
 * Upload image files and create image shapes centered near `at`. Returns the
 * new shape ids (uploads run sequentially; failures are skipped).
 */
export async function placeImageFiles(
  files: File[],
  at: Point,
): Promise<string[]> {
  const ids: string[] = [];
  let offset = 0;
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    try {
      const up = await uploadImageFile(file);
      let w = up.naturalWidth || 300;
      let h = up.naturalHeight || 200;
      if (w > MAX_PLACE || h > MAX_PLACE) {
        const scale = MAX_PLACE / Math.max(w, h);
        w *= scale;
        h *= scale;
      }
      const shape = {
        id: genId(),
        type: 'image',
        x: at.x - w / 2 + offset,
        y: at.y - h / 2 + offset,
        rotation: 0,
        index: getTopIndex(editor.getShapes()),
        props: {
          blobId: up.blobId,
          w,
          h,
          naturalWidth: up.naturalWidth,
          naturalHeight: up.naturalHeight,
        },
      } as Shape;
      editor.createShape(shape);
      ids.push(shape.id);
      offset += 16;
    } catch (err) {
      console.error('[image] upload failed', err);
    }
  }
  return ids;
}

/**
 * Open a native file picker, place the chosen images at the viewport center,
 * then select them (matching the paste/drop flow). Drives the toolbar button.
 */
export async function pickAndPlaceImages(): Promise<void> {
  const files = await pickImageFiles();
  if (!files.length) return;
  // The canvas container fills the window, so window-center ≈ its center.
  const center = screenToWorld(
    { x: window.innerWidth / 2, y: window.innerHeight / 2 },
    useCameraStore.getState().camera,
  );
  const ids = await placeImageFiles(files, center);
  if (ids.length) {
    useToolStore.getState().setTool('select');
    useSelectionStore.getState().setSelection(ids);
  }
}

/** Prompt for image files via a transient `<input type="file">`. */
function pickImageFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = ACCEPT;
    input.multiple = true;
    input.onchange = () => resolve(input.files ? Array.from(input.files) : []);
    // Some browsers don't fire `change` on cancel; resolve empty on focus return.
    input.click();
  });
}
