import { genId, type Point, type Shape } from '@whiteboard/shared';
import {
  deleteLocalImageUrl,
  imageDimensions,
  imageHref,
  setLocalImageUrl,
  uploadImageFile,
  type UploadedImage,
} from '../board/blobs';
import { screenToWorld } from './camera';
import { getTopIndex, jitterKeyBetween } from './order';
import { useCameraStore } from './use-camera-store';
import {
  currentSession,
  editor,
  updateShapeOnPage,
} from './use-document-store';
import { useSelectionStore } from './use-selection-store';
import { useToolStore } from './use-tool-store';

/** Largest dimension (world units) a freshly-placed image is fit to. */
const MAX_PLACE = 600;

/** Image types accepted by the picker (mirrors the server allow-list). */
const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';

/**
 * Create image shapes centered near `at` and return their ids, in two phases
 * (like pasted links). Phase 1 only reads each file's dimensions: the shapes
 * appear immediately for this client, drawn from a local object URL. Phase 2
 * compresses and uploads in the background, then patches the blob id in so
 * peers — who see an empty placeholder until then — load the image too.
 */
export async function placeImageFiles(
  files: File[],
  at: Point,
): Promise<string[]> {
  const images = files.filter((f) => f.type.startsWith('image/'));
  const dims = await Promise.all(images.map(imageDimensions));
  const ids: string[] = [];
  const pageId = currentSession()?.currentPageId;
  // One transaction: a multi-image paste is a single undo step. `getShapes()`
  // is stale inside it, so the top is taken once and carried forward.
  let index = getTopIndex(editor.getShapes());
  editor.transact(() => {
    let offset = 0;
    images.forEach((file, i) => {
      const { width, height } = dims[i]!;
      let w = width;
      let h = height;
      if (w > MAX_PLACE || h > MAX_PLACE) {
        const scale = MAX_PLACE / Math.max(w, h);
        w *= scale;
        h *= scale;
      }
      const id = genId();
      // Registered before the shape exists so its first render already has it.
      setLocalImageUrl(id, URL.createObjectURL(file));
      editor.createShape({
        id,
        type: 'image',
        x: at.x - w / 2 + offset,
        y: at.y - h / 2 + offset,
        rotation: 0,
        index,
        props: {
          blobId: '',
          w,
          h,
          naturalWidth: width,
          naturalHeight: height,
        },
      } as Shape);
      ids.push(id);
      offset += 16;
      index = jitterKeyBetween(index, null);
    });
  });
  if (pageId) {
    images.forEach((file, i) => void uploadPlacedImage(pageId, ids[i]!, file));
  }
  return ids;
}

/**
 * Upload a placed image and patch its blob id in. Written outside undo history
 * (as link previews are): Ctrl+Z should step back over the whole paste, not
 * peel the upload off it first.
 */
async function uploadPlacedImage(
  pageId: string,
  id: string,
  file: File,
): Promise<void> {
  const localUrl = imageHref(id, '')!;
  let up: UploadedImage;
  try {
    up = await uploadImageFile(file);
  } catch (error) {
    console.error('[image] upload failed', error);
    deleteLocalImageUrl(id);
    URL.revokeObjectURL(localUrl);
    // Peers could never load it; remove the placeholder they're seeing.
    await updateShapeOnPage(pageId, id, () => null);
    return;
  }
  // Swap the preview over to the bytes that were actually uploaded, so the
  // switch to a blob id costs no re-download *and* this client stops painting
  // the original file — a phone photo or retina screenshot is several times
  // the pixels of the compressed copy every peer gets, and the shape is drawn
  // into a box at most MAX_PLACE across either way.
  const uploadedUrl = URL.createObjectURL(up.blob);
  setLocalImageUrl(id, uploadedUrl);
  setLocalImageUrl(up.blobId, uploadedUrl);
  // Safe once both keys point at the replacement: an <image> that already
  // painted keeps its decoded bitmap, and a remount re-reads `imageHref`.
  URL.revokeObjectURL(localUrl);
  await updateShapeOnPage(pageId, id, (shape) =>
    shape.type === 'image' && !shape.props.blobId
      ? {
          props: {
            blobId: up.blobId,
            naturalWidth: up.naturalWidth,
            naturalHeight: up.naturalHeight,
            ...(up.thumbBlobId ? { thumbBlobId: up.thumbBlobId } : {}),
          },
        }
      : undefined,
  );
  deleteLocalImageUrl(id);
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
