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
import { getTopIndex } from './order';
import { useCameraStore } from './use-camera-store';
import { editor, withoutUndo } from './use-document-store';
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
  // One transaction: a multi-image paste is a single undo step.
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
        index: getTopIndex(editor.getShapes()),
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
    });
  });
  images.forEach((file, i) => void uploadPlacedImage(ids[i]!, file));
  return ids;
}

/**
 * Upload a placed image and patch its blob id in. Written outside undo history
 * (as link previews are): Ctrl+Z should step back over the whole paste, not
 * peel the upload off it first.
 */
async function uploadPlacedImage(id: string, file: File): Promise<void> {
  const localUrl = imageHref(id, '')!;
  let up: UploadedImage;
  try {
    up = await uploadImageFile(file);
  } catch (error) {
    console.error('[image] upload failed', error);
    deleteLocalImageUrl(id);
    URL.revokeObjectURL(localUrl);
    // Peers could never load it; remove the placeholder they're seeing.
    withoutUndo(() => editor.deleteShapes([id]));
    return;
  }
  // Rekey the preview rather than dropping it, so the switch to a blob id
  // doesn't make this client re-download the bytes it already has.
  setLocalImageUrl(up.blobId, localUrl);
  const shape = editor.getShape(id);
  if (shape?.type === 'image' && !shape.props.blobId) {
    withoutUndo(() => {
      editor.updateShape(id, {
        props: {
          blobId: up.blobId,
          naturalWidth: up.naturalWidth,
          naturalHeight: up.naturalHeight,
        },
      });
    });
  }
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
