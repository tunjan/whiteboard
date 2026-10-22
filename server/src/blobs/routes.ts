import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { clientIp, uploadBudget } from '../rate-limit';
import { StorageFullError } from '../storage-quota';
import { requireBoardEdit } from '../boards/access';
import {
  ALLOWED_MIME,
  MAX_BLOB_BYTES,
  MAX_VIDEO_BYTES,
  VIDEO_MIME,
  blobPath,
  isValidBlobId,
  mimeForBlobId,
  readBlob,
  saveBlob,
} from './store';

// Image and video blob store. Uploads are open to anyone who may edit a board (the tutor,
// or a student whose link grants edit) so students can paste/drop images and videos too;
// safety comes from the
// strict type allow-list, the size cap, content-addressed ids that can't be
// guessed or used for path traversal, a per-client upload budget and a disk
// quota.
export const blobRoutes = new Hono();

blobRoutes.post(
  '/',
  requireBoardEdit,
  bodyLimit({
    maxSize: MAX_VIDEO_BYTES,
    onError: (c) => c.json({ error: 'File too large' }, 413),
  }),
  async (c) => {
    const mime = (c.req.header('content-type') ?? '').split(';')[0]!.trim();
    const video = !!VIDEO_MIME[mime];
    if (!ALLOWED_MIME[mime] && !video) {
      return c.json({ error: 'Unsupported file type' }, 415);
    }
    const body = await c.req.arrayBuffer();
    if (body.byteLength === 0) return c.json({ error: 'Empty body' }, 400);
    if (!video && body.byteLength > MAX_BLOB_BYTES) {
      return c.json({ error: 'Image too large' }, 413);
    }
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
  // Video elements fetch by byte range; Safari won't play without it, and every
  // browser needs it to seek past what has buffered.
  const range = c.req.header('range');
  if (range) {
    const path = blobPath(id);
    if (!path) return c.json({ error: 'Not found' }, 404);
    const { size } = await stat(path);
    const span = parseRange(range, size);
    if (!span) {
      return c.body(null, 416, { 'Content-Range': `bytes */${size}` });
    }
    const [start, end] = span;
    const stream = Readable.toWeb(createReadStream(path, { start, end }));
    return c.body(stream as ReadableStream, 206, {
      'Content-Type': mimeForBlobId(id) ?? 'application/octet-stream',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
  }
  const bytes = await readBlob(id);
  if (!bytes) return c.json({ error: 'Not found' }, 404);
  return c.body(bytes as unknown as ArrayBuffer, 200, {
    'Content-Type': mimeForBlobId(id) ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    // Content-addressed → safe to cache forever.
    'Cache-Control': 'public, max-age=31536000, immutable',
  });
});

/**
 * One `bytes=start-end` / `bytes=start-` / `bytes=-suffix` range, clamped to the
 * file, as inclusive offsets; null when unsatisfiable. Multi-range requests are
 * answered with their first range, which the spec allows.
 */
export function parseRange(header: string, size: number): [number, number] | null {
  const m = /^bytes=(\d*)-(\d*)/.exec(header.trim());
  if (!m || (!m[1] && !m[2]) || size === 0) return null;
  let start: number;
  let end: number;
  if (!m[1]) {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  return start <= end && start < size ? [start, end] : null;
}
