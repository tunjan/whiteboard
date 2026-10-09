import { boardHeaders } from '@/board/board-access';

/** URL for a stored image blob (proxied to the collab server in dev). */
export function blobUrl(id: string): string {
  return `/api/blobs/${id}`;
}

// Object URLs for images this client placed itself, so it shows them before the
// upload lands and never re-downloads its own bytes afterwards. Keyed by shape
// id while the upload is pending, then by blob id once the server assigns one.
const localImageUrls = new Map<string, string>();

export function setLocalImageUrl(key: string, url: string): void {
  localImageUrls.set(key, url);
}

export function deleteLocalImageUrl(key: string): void {
  localImageUrls.delete(key);
}

/** Where an image shape's bytes load from; null while a peer's upload is pending. */
export function imageHref(shapeId: string, blobId: string): string | null {
  return (
    localImageUrls.get(blobId || shapeId) ?? (blobId ? blobUrl(blobId) : null)
  );
}

// Downscale large photos before upload to keep boards light and sync fast.
const COMPRESS_OPTS = {
  maxSizeMB: 1,
  maxWidthOrHeight: 2000,
  useWebWorker: true,
};
// Animated/lossless-ish types we leave untouched (recompression would break
// animation or bloat them).
const PASSTHROUGH = new Set(['image/gif']);

export interface UploadedImage {
  blobId: string;
  naturalWidth: number;
  naturalHeight: number;
  /** The bytes actually uploaded — the compressed copy, where one was made.
   *  The caller that placed the shape swaps its preview over to these, so it
   *  stops holding (and painting) the original camera-resolution file. */
  blob: Blob;
  /** The small copy drawn when the image is small on screen, when one was
   *  made — see `uploadImageThumb`. */
  thumbBlobId?: string;
}

/** Compress (when sensible), read dimensions, and upload an image file. */
export async function uploadImageFile(file: File): Promise<UploadedImage> {
  let blob: Blob = file;
  if (file.type.startsWith('image/') && !PASSTHROUGH.has(file.type)) {
    try {
      // Loaded on demand: the compressor is only reachable once someone adds an
      // image, so keeping it out of the entry chunk costs nothing here and
      // saves every board load that never places one. The existing fallback
      // covers a failed chunk fetch as well as a failed compression.
      const { default: imageCompression } = await import(
        'browser-image-compression'
      );
      blob = await imageCompression(file, COMPRESS_OPTS);
    } catch {
      blob = file; // fall back to the original on any compression failure
    }
  }
  const { width, height } = await imageDimensions(blob);
  const [blobId, thumbBlobId] = await Promise.all([
    uploadImageBlob(blob, blob.type || file.type),
    // A GIF's thumbnail would be its first frame: zooming out would stop it.
    PASSTHROUGH.has(file.type)
      ? undefined
      : uploadImageThumb(blob, width, height),
  ]);
  return { blobId, naturalWidth: width, naturalHeight: height, blob, thumbBlobId };
}

/**
 * Long side, in pixels, of the copy an image is drawn from once it is small on
 * screen (`ImageProps.thumbBlobId`).
 *
 * Measured with 2000x1500 sources, the upload cap: past ~1.2 GB of decoded
 * originals on screen at once (~110 photos, or ~150 PDF pages) the browser's
 * decoded-image cache thrashes and every repaint re-decodes, 1.4-1.6 s each.
 * 256px copies held the same repaint at ~2 ms. 512 keeps a copy sharp up to
 * 256 CSS px on a 2x display for 0.75 MB decoded instead of 11.4.
 */
export const IMAGE_THUMB_PX = 512;

/**
 * Make and upload the small copy of an image, or resolve undefined when it is
 * not worth one (the original is already near that size) or anything fails. A
 * missing thumbnail only means the original is drawn at every zoom, so no
 * failure here is allowed to fail the upload it rides along with.
 */
export async function uploadImageThumb(
  blob: Blob,
  width: number,
  height: number,
): Promise<string | undefined> {
  const longest = Math.max(width, height);
  if (longest <= IMAGE_THUMB_PX * 1.5) return undefined;
  try {
    const scale = IMAGE_THUMB_PX / longest;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    const bmp = await createImageBitmap(blob);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    // JPEG stays JPEG; anything else may carry alpha, so PNG.
    const type = blob.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
    const thumb = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, type, 0.85),
    );
    return thumb ? await uploadImageBlob(thumb, thumb.type) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Upload already-prepared image bytes; returns the content-addressed blob id.
 * Callers that produced the bytes themselves (the sticker cut-out) use this
 * directly — recompressing that PNG would only cost it its alpha channel.
 */
export async function uploadImageBlob(
  blob: Blob,
  mime = blob.type,
): Promise<string> {
  const res = await fetch('/api/blobs', {
    method: 'POST',
    body: blob,
    headers: { 'Content-Type': mime, ...boardHeaders() },
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`Image upload failed (${res.status})`);
  const { id } = (await res.json()) as { id: string };
  return id;
}

export async function imageDimensions(
  blob: Blob,
): Promise<{ width: number; height: number }> {
  try {
    const bmp = await createImageBitmap(blob);
    const dims = { width: bmp.width, height: bmp.height };
    bmp.close();
    return dims;
  } catch {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        resolve({ width: img.naturalWidth || 300, height: img.naturalHeight || 200 });
        URL.revokeObjectURL(url);
      };
      img.onerror = () => {
        resolve({ width: 300, height: 200 });
        URL.revokeObjectURL(url);
      };
      img.src = url;
    });
  }
}
