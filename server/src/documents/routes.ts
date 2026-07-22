import { Hono } from 'hono';
import {
  DOCUMENT_MIME,
  INLINE_DOCUMENT_EXTS,
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENT_NAME_LENGTH,
} from '@whiteboard/shared';
import { extForDocId, isValidDocId, readDoc, saveDoc } from './store';

// Board document repository bytes. Like the image blob store, uploads are open
// — anyone with a board's capability URL can add files. Safety comes from the
// strict extension allow-list (no HTML/SVG), the size cap, content-addressed
// ids that can't be guessed or used for path traversal, and serving anything
// that isn't a safe inline type as a download.
//
// The list of documents on a board lives in the Yjs doc, not here: this module
// only stores and serves bytes. There is deliberately no delete endpoint —
// storage is content-addressed, so the same bytes may be referenced by another
// board.
export const documentRoutes = new Hono();

documentRoutes.post('/', async (c) => {
  const ext = (c.req.query('ext') ?? '').toLowerCase();
  if (!DOCUMENT_MIME[ext]) {
    return c.json({ error: 'Unsupported file type' }, 415);
  }
  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) return c.json({ error: 'Empty body' }, 400);
  if (body.byteLength > MAX_DOCUMENT_BYTES) {
    return c.json({ error: 'File too large' }, 413);
  }
  const storageId = await saveDoc(Buffer.from(body), ext);
  return c.json({ storageId });
});

documentRoutes.get('/:storageId', async (c) => {
  const storageId = c.req.param('storageId');
  if (!isValidDocId(storageId)) return c.json({ error: 'Not found' }, 404);
  const bytes = await readDoc(storageId);
  if (!bytes) return c.json({ error: 'Not found' }, 404);
  const ext = extForDocId(storageId);
  const disposition = INLINE_DOCUMENT_EXTS.has(ext) ? 'inline' : 'attachment';
  return c.body(bytes as unknown as ArrayBuffer, 200, {
    'Content-Type': DOCUMENT_MIME[ext] ?? 'application/octet-stream',
    'Content-Disposition': contentDisposition(
      disposition,
      c.req.query('name') ?? '',
      storageId,
    ),
    // Types outside the inline allow-list must never be sniffed into something
    // renderable.
    'X-Content-Type-Options': 'nosniff',
    // Content-addressed → safe to cache forever.
    'Cache-Control': 'public, max-age=31536000, immutable',
  });
});

/** Control chars (header injection) plus quotes and slashes (header/path escape). */
const UNSAFE_NAME_RE = /[\u0000-\u001f\u007f-\u009f"\\/]/g;

/**
 * Build a Content-Disposition header for a client-supplied filename. The name
 * reaches us from an open endpoint, so anything that could break out of the
 * header or the download directory is stripped first.
 */
function contentDisposition(
  disposition: 'inline' | 'attachment',
  name: string,
  fallback: string,
): string {
  const clean = name
    .replace(UNSAFE_NAME_RE, '')
    .trim()
    .slice(0, MAX_DOCUMENT_NAME_LENGTH);
  const safe = clean || fallback;
  // ASCII-only copy for clients that don't understand the RFC 5987 form.
  const ascii = safe.replace(/[^ -~]/g, '_');
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}
