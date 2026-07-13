import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import {
  MAX_RECORDING_BYTES,
  MAX_RECORDING_NAME_LENGTH,
  type RecordingMeta,
  isAnimationRecording,
} from '@whiteboard/shared';
import { requireTutor } from '../auth/middleware';
import { db } from '../db/client';
import { boards, recordings } from '../db/schema';

// Animation recordings. Reads are open — anyone with a board's capability URL
// can list and replay recordings (same trust model as the collab WebSocket).
// Creating and deleting recordings is tutor-only, like recording itself.
export const recordingRoutes = new Hono();

// nanoid alphabet; keeps ids safe to use in URLs and cache keys.
const RECORDING_ID_PATTERN = /^[A-Za-z0-9_-]{10,30}$/;

type RecordingRow = Omit<typeof recordings.$inferSelect, 'data'>;

function toMeta(row: RecordingRow): RecordingMeta {
  return {
    id: row.id,
    boardId: row.boardId,
    pageId: row.pageId,
    name: row.name,
    durationMs: row.durationMs,
    createdAt: row.createdAt.getTime(),
  };
}

const metaColumns = {
  id: recordings.id,
  boardId: recordings.boardId,
  pageId: recordings.pageId,
  name: recordings.name,
  durationMs: recordings.durationMs,
  createdAt: recordings.createdAt,
};

recordingRoutes.get('/:boardId', async (c) => {
  const boardId = c.req.param('boardId');
  const rows = await db
    .select(metaColumns)
    .from(recordings)
    .where(eq(recordings.boardId, boardId))
    .orderBy(desc(recordings.createdAt));
  return c.json(rows.map(toMeta));
});

recordingRoutes.get('/:boardId/:id', async (c) => {
  const boardId = c.req.param('boardId');
  const id = c.req.param('id');
  const [row] = await db
    .select({ data: recordings.data })
    .from(recordings)
    .where(and(eq(recordings.id, id), eq(recordings.boardId, boardId)));
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.body(row.data as unknown as ArrayBuffer, 200, {
    'Content-Type': 'application/json',
    // Rows are immutable once created (ids are minted per recording).
    'Cache-Control': 'private, max-age=31536000, immutable',
  });
});

recordingRoutes.post('/:boardId', requireTutor, async (c) => {
  const boardId = c.req.param('boardId');
  const raw = await c.req.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_RECORDING_BYTES) {
    return c.json({ error: 'Recording too large' }, 413);
  }
  let body: { id?: unknown; name?: unknown; recording?: unknown };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }
  const id = typeof body.id === 'string' ? body.id : '';
  if (!RECORDING_ID_PATTERN.test(id)) {
    return c.json({ error: 'Invalid id' }, 400);
  }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > MAX_RECORDING_NAME_LENGTH) {
    return c.json({ error: 'Invalid name' }, 400);
  }
  if (!isAnimationRecording(body.recording)) {
    return c.json({ error: 'Invalid recording' }, 400);
  }
  const [board] = await db
    .select({ id: boards.id })
    .from(boards)
    .where(eq(boards.id, boardId));
  if (!board) return c.json({ error: 'board not found' }, 404);
  const createdAt = new Date();
  await db
    .insert(recordings)
    .values({
      id,
      boardId,
      pageId: body.recording.pageId,
      name,
      durationMs: Math.round(body.recording.durationMs),
      data: Buffer.from(JSON.stringify(body.recording), 'utf8'),
      createdAt,
    })
    // Client retries reuse the same minted id → safe to replay the request.
    .onConflictDoNothing({ target: recordings.id });
  return c.json({
    id,
    boardId,
    pageId: body.recording.pageId,
    name,
    durationMs: Math.round(body.recording.durationMs),
    createdAt: createdAt.getTime(),
  } satisfies RecordingMeta);
});

recordingRoutes.delete('/:boardId/:id', requireTutor, async (c) => {
  const boardId = c.req.param('boardId');
  const id = c.req.param('id');
  await db
    .delete(recordings)
    .where(and(eq(recordings.id, id), eq(recordings.boardId, boardId)));
  return c.json({ ok: true });
});
