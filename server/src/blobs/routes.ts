import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { clientIp, uploadBudget } from '../rate-limit';
import { StorageFullError } from '../storage-quota';
import { requireBoardEdit } from '../boards/access';
import {
  ALLOWED_MIME,
  MAX_BLOB_BYTES,
  isValidBlobId,
  mimeForBlobId,
  readBlob,
  saveBlob,
} from './store';

// Image blob store. Uploads are open to anyone who may edit a board (the tutor,
// or a student whose link grants edit) so students can paste/drop images too;
// safety comes from the
// strict type allow-list, the size cap, content-addressed ids that can't be
// guessed or used for path traversal, a per-client upload budget and a disk
// quota.
export const blobRoutes = new Hono();

blobRoutes.post(
  '/',
  requireBoardEdit,
  bodyLimit({
    maxSize: MAX_BLOB_BYTES,
    onError: (c) => c.json({ error: 'Image too large' }, 413),
  }),
  async (c) => {
    const mime = (c.req.header('content-type') ?? '').split(';')[0]!.trim();
    if (!ALLOWED_MIME[mime]) {
      return c.json({ error: 'Unsupported image type' }, 415);
    }
    const body = await c.req.arrayBuffer();
    if (body.byteLength === 0) return c.json({ error: 'Empty body' }, 400);
    if (!uploadBudget(clientIp(c), body.byteLength)) {
      return c.json({ error: 'Too many uploads' }, 429);
    }
    try {
      return c.json({ id: await saveBlob(Buffer.from(body), mime) });
    } catch (error) {
      if (error instanceof StorageFullError) {
        return c.json({ error: 'Storage full' }, 507);
      }
      throw error;
    }
  },
);

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
