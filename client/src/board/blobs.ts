import imageCompression from 'browser-image-compression';

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
      blob = await imageCompression(file, COMPRESS_OPTS);
    } catch {
      blob = file; // fall back to the original on any compression failure
    }
  }
  const { width, height } = await imageDimensions(blob);
  const res = await fetch('/api/blobs', {
    method: 'POST',
    body: blob,
    headers: { 'Content-Type': blob.type || file.type },
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`Image upload failed (${res.status})`);
  const { id } = (await res.json()) as { id: string };
  return { blobId: id, naturalWidth: width, naturalHeight: height };
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
