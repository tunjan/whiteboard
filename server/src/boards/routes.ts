import { Hono } from 'hono';
import { desc, eq, or, sql } from 'drizzle-orm';
import {
  type BoardMeta,
  genBoardId,
  pageDocumentPrefix,
} from '@whiteboard/shared';
import { requireTutor } from '../auth/middleware';
import { db } from '../db/client';
import { boardDocuments, boards } from '../db/schema';

type BoardRow = typeof boards.$inferSelect;

function toMeta(row: BoardRow): BoardMeta {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    lastOpenedAt: row.lastOpenedAt.getTime(),
  };
}

// All board management is tutor-only.
export const boardRoutes = new Hono();
boardRoutes.use('*', requireTutor);

boardRoutes.get('/', async (c) => {
  const rows = await db
    .select()
    .from(boards)
    .orderBy(desc(boards.lastOpenedAt));
  return c.json(rows.map(toMeta));
});

// Idempotent upsert — supports the client's offline outbox (client mints the id).
boardRoutes.post('/', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    id?: string;
    name?: string;
  };
  const id = typeof body.id === 'string' && body.id ? body.id : genBoardId();
  const name =
    (typeof body.name === 'string' && body.name.trim()) || 'Untitled board';
  const now = new Date();
  const [row] = await db
    .insert(boards)
    .values({ id, name, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: boards.id, set: { name, updatedAt: now } })
    .returning();
  return c.json(toMeta(row!));
});

boardRoutes.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as { name?: string };
  const name =
    typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null;
  if (!name) return c.json({ error: 'name required' }, 400);
  const [row] = await db
    .update(boards)
    .set({ name, updatedAt: new Date() })
    .where(eq(boards.id, id))
    .returning();
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json(toMeta(row));
});

boardRoutes.post('/:id/opened', async (c) => {
  const id = c.req.param('id');
  const [row] = await db
    .update(boards)
    .set({ lastOpenedAt: new Date() })
    .where(eq(boards.id, id))
    .returning();
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json(toMeta(row));
});

// Tutor-only private notes and error log about the student. Stored relationally
// and served only here (behind requireTutor) so they never reach a student client.
boardRoutes.get('/:id/notes', async (c) => {
  const id = c.req.param('id');
  const [row] = await db
    .select({ privateNotes: boards.privateNotes, errorLog: boards.errorLog })
    .from(boards)
    .where(eq(boards.id, id));
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json({ notes: row.privateNotes, errorLog: row.errorLog });
});

boardRoutes.put('/:id/notes', async (c) => {
  const id = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as {
    notes?: string;
    errorLog?: string;
  };
  // Only the fields present are written, so saving one pane never clears the other.
  const set: { privateNotes?: string; errorLog?: string } = {};
  if (typeof body.notes === 'string') set.privateNotes = body.notes;
  if (typeof body.errorLog === 'string') set.errorLog = body.errorLog;
  if (Object.keys(set).length === 0) return c.json({ error: 'nothing to update' }, 400);
  const [row] = await db
    .update(boards)
    .set(set)
    .where(eq(boards.id, id))
    .returning({ id: boards.id });
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true });
});

boardRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  // A board is stored as several documents: its own, plus one per page (see
  // `pageDocumentName`). `starts_with` rather than a LIKE pattern because a
  // board id may legitimately contain `_`, which LIKE would read as a wildcard.
  await db
    .delete(boardDocuments)
    .where(
      or(
        eq(boardDocuments.documentName, id),
        sql`starts_with(${boardDocuments.documentName}, ${pageDocumentPrefix(id)})`,
      ),
    );
  await db.delete(boards).where(eq(boards.id, id));
  return c.json({ ok: true });
});
