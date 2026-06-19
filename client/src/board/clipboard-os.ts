import type { Editor } from '../canvas/editor';
import { wbClipHtml } from '../canvas/clipboard';
import { blobUrl } from './blobs';

/**
 * Write an in-app copy to the macOS clipboard. Always stamps an HTML marker
 * (so our own paste can recognize and prefer this copy); when the selection is
 * exactly one image, also writes the image as PNG so it can be pasted into
 * other apps. Best-effort — silently no-ops when the Clipboard API is missing
 * or write is denied (e.g. a non-secure context).
 */
export async function writeShapesToOsClipboard(
  editor: Editor,
  ids: string[],
  token: string,
): Promise<void> {
  if (!navigator.clipboard?.write) return;
  const html = new Blob([wbClipHtml(token)], { type: 'text/html' });
  const items: Record<string, Blob | Promise<Blob>> = { 'text/html': html };

  const only = ids.length === 1 ? editor.getShape(ids[0]!) : undefined;
  if (only?.type === 'image') {
    items['image/png'] = imageBlobToPng(only.props.blobId);
  }

  try {
    await navigator.clipboard.write([new ClipboardItem(items)]);
  } catch (err) {
    console.error('[clipboard] OS write failed', err);
  }
}

/** Fetch a stored image blob and return it as a PNG (re-encoding if needed). */
async function imageBlobToPng(blobId: string): Promise<Blob> {
  const res = await fetch(blobUrl(blobId), { credentials: 'include' });
  const blob = await res.blob();
  if (blob.type === 'image/png') return blob;

  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bmp.close();
    throw new Error('Canvas 2D context unavailable');
  }
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('toBlob returned null'))),
      'image/png',
    ),
  );
}
