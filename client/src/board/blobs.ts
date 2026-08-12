/** URL for a stored image blob (proxied to the collab server in dev). */
export function blobUrl(id: string): string {
  return `/api/blobs/${id}`;
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
  const blobId = await uploadImageBlob(blob, blob.type || file.type);
  return { blobId, naturalWidth: width, naturalHeight: height };
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
    headers: { 'Content-Type': mime },
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`Image upload failed (${res.status})`);
  const { id } = (await res.json()) as { id: string };
  return id;
}

async function imageDimensions(
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
