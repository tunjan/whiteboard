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

/**
 * Write a PNG to the system clipboard, given a blob that is still rendering.
 *
 * Safari only allows `navigator.clipboard.write` while the user gesture that
 * triggered it is still the current task, so awaiting the render before calling
 * it fails with `NotAllowedError`. `ClipboardItem` accepts a `Promise<Blob>`
 * precisely for this: the item is constructed synchronously and the browser
 * waits on the promise itself, keeping the write inside the activation window.
 *
 * Firefox has no promise support in `ClipboardItem`, so a rejected write is
 * retried once with the resolved blob. That retry is outside the gesture, which
 * Firefox permits but Safari does not — hence trying the promise form first.
 */
export function writePngToClipboard(png: Promise<Blob>): Promise<void> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    // Nothing will consume the render; settle it so it can't surface as an
    // unhandled rejection.
    void png.catch(() => undefined);
    return Promise.reject(new Error('Clipboard API unavailable'));
  }
  return navigator.clipboard
    .write([new ClipboardItem({ 'image/png': png })])
    .catch(async () => {
      // Awaiting here also re-raises a render failure, so a broken export
      // reports its own cause rather than the clipboard rejection it caused.
      const blob = await png;
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob }),
      ]);
    });
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
