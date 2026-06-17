import { Hono } from 'hono';
import {
  ALLOWED_MIME,
  MAX_BLOB_BYTES,
  isValidBlobId,
  mimeForBlobId,
  readBlob,
  saveBlob,
} from './store';

// Image blob store. Uploads are open (no tutor gate) so students sharing a
// board's capability URL can paste/drop images too; safety comes from the
// strict type allow-list, the size cap, and content-addressed ids that can't
// be guessed or used for path traversal.
export const blobRoutes = new Hono();

blobRoutes.post('/', async (c) => {
  const mime = (c.req.header('content-type') ?? '').split(';')[0]!.trim();
  if (!ALLOWED_MIME[mime]) {
    return c.json({ error: 'Unsupported image type' }, 415);
  }
  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) return c.json({ error: 'Empty body' }, 400);
  if (body.byteLength > MAX_BLOB_BYTES) {
    return c.json({ error: 'Image too large' }, 413);
  }
  const id = await saveBlob(Buffer.from(body), mime);
  return c.json({ id });
});

blobRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  if (!isValidBlobId(id)) return c.json({ error: 'Not found' }, 404);
  const bytes = await readBlob(id);
  if (!bytes) return c.json({ error: 'Not found' }, 404);
  return c.body(bytes as unknown as ArrayBuffer, 200, {
    'Content-Type': mimeForBlobId(id) ?? 'application/octet-stream',
    // Content-addressed → safe to cache forever.
    'Cache-Control': 'public, max-age=31536000, immutable',
  });
});
