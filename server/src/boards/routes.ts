import { Hono } from 'hono';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import {
  AGENT_HELP_MODES,
  FEATURES_MESSAGE,
  type AgentHelp,
  type BoardMeta,
  type BoardShare,
  SHARE_MODES,
  type ShareMode,
  genBoardId,
  pageDocumentPrefix,
} from '@whiteboard/shared';
import { createMiddleware } from 'hono/factory';
import { currentTutor, requireTutor } from '../auth/middleware';
import { requestAccess } from './access';
import { featuresFor, fullFeatureSet } from './features';
import {
  BoardFileError,
  exportBoard,
  importBoard,
  unpackBoardFile,
} from './board-file';
import {
  closeBoardDocuments,
  disconnectStudents,
  liveBoards,
  notifyBoard,
  removeClient,
} from '../collab/hocuspocus';
import { db } from '../db/client';
import {
  boardDocumentUpdates,
  boardDocuments,
  boardSessionNotes,
  boards,
} from '../db/schema';

type BoardRow = typeof boards.$inferSelect;

function toMeta(row: BoardRow): BoardMeta {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    lastOpenedAt: row.lastOpenedAt.getTime(),
    favorite: row.favorite,
  };
}

export const boardRoutes = new Hono();

/**
 * A board's display name, and nothing else.
 *
 * Registered above the tutor guard below so a student's link reaches it: anyone
 * whose key opens the board reads every shape on it over the socket, so its
 * title is strictly less than what they have. Without access it is a 404, not a
 * 403, so a guessed id says nothing about whether the board exists. Deliberately not `toMeta` — the
 * timestamps are management data, and this is what a student needs to see the
 * board they were invited to instead of the word "Whiteboard".
 */
boardRoutes.get('/:id/title', async (c) => {
  if (!(await requestAccess(c, c.req.param('id')))) {
    return c.json({ error: 'not found' }, 404);
  }
  const [row] = await db
    .select({ name: boards.name })
    .from(boards)
    .where(eq(boards.id, c.req.param('id')));
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json({ name: row.name });
});

/**
 * The whole board as a `.board` file (see `board-file.ts`). Open to the same
 * students as the title: their link already syncs every page and asset in it.
 */
boardRoutes.get('/:id/export', async (c) => {
  const id = c.req.param('id');
  if (!(await requestAccess(c, id))) return c.json({ error: 'not found' }, 404);
  const [row] = await db
    .select({ name: boards.name })
    .from(boards)
    .where(eq(boards.id, id));
  if (!row) return c.json({ error: 'not found' }, 404);
  const file = await exportBoard(id, row.name);
  const ascii = row.name.replace(/[^\w\- ]+/g, '_') || 'board';
  return c.body(file as unknown as ArrayBuffer, 200, {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${ascii}.board"; filename*=UTF-8''${encodeURIComponent(row.name)}.board`,
  });
});

/** What the board offers (see `features.ts`). Open to the same students as the title. */
boardRoutes.get('/:id/features', async (c) => {
  const id = c.req.param('id');
  if (!(await requestAccess(c, id))) return c.json({ error: 'not found' }, 404);
  return c.json(await featuresFor(id));
});

// Everything else about a board is management, and management is tutor-only —
// for the board's own tutor. Another tutor's board is a 404, as if it didn't exist.
boardRoutes.use('*', requireTutor);
const ownsBoard = createMiddleware(async (c, next) => {
  const id = c.req.param('id');
  // The two routes at this depth that name no board.
  if (id === 'live' || id === 'import' || !id) return next();
  const [row] = await db
    .select({ id: boards.id })
    .from(boards)
    .where(and(eq(boards.id, id), eq(boards.tutorId, currentTutor(c).id)));
  if (!row) return c.json({ error: 'not found' }, 404);
  await next();
});
boardRoutes.use('/:id', ownsBoard);
boardRoutes.use('/:id/*', ownsBoard);

// A `.board` file becomes a new board. The row is written last, so a file that
// fails partway never shows up in the library.
boardRoutes.post('/import', async (c) => {
  const id = genBoardId();
  try {
    const file = await unpackBoardFile(new Uint8Array(await c.req.arrayBuffer()));
    await importBoard(id, file);
    const now = new Date();
    const [row] = await db
      .insert(boards)
      .values({
        id,
        name: file.name.trim() || 'Untitled board',
        tutorId: currentTutor(c).id,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return c.json(toMeta(row!));
  } catch (error) {
    if (error instanceof BoardFileError) {
      return c.json({ error: error.message }, 400);
    }
    throw error;
  }
});

boardRoutes.get('/', async (c) => {
  const rows = await db
    .select()
    .from(boards)
    .where(eq(boards.tutorId, currentTutor(c).id))
    .orderBy(desc(boards.lastOpenedAt));
  return c.json(rows.map(toMeta));
});

const SHARE_COLUMNS = {
  key: boards.shareKey,
  mode: boards.shareMode,
  agentHelp: boards.agentHelp,
  features: boards.features,
};

// The student link: its key and what it grants.
boardRoutes.get('/:id/access', async (c) => {
  const [row] = await db
    .select(SHARE_COLUMNS)
    .from(boards)
    .where(eq(boards.id, c.req.param('id')));
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json(row as BoardShare);
});

// Change what the link grants. Students already in reconnect under the new
// mode (or are refused, for 'off').
// What "Ask the board" does for them is read per request: no reconnect.
// A features change (a full set, or null for the tutor's defaults) is pushed
// to everyone on the board, who refetch.
boardRoutes.patch('/:id/access', async (c) => {
  const id = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as {
    mode?: unknown;
    agentHelp?: unknown;
    features?: unknown;
  };
  const mode = body.mode as ShareMode | undefined;
  const agentHelp = body.agentHelp as AgentHelp | undefined;
  if (mode !== undefined && !SHARE_MODES.includes(mode)) {
    return c.json({ error: 'mode must be edit, view or off' }, 400);
  }
  if (agentHelp !== undefined && !AGENT_HELP_MODES.includes(agentHelp)) {
    return c.json({ error: 'agentHelp must be full, hints or off' }, 400);
  }
  const features = body.features === null ? null : fullFeatureSet(body.features);
  if (body.features !== undefined && body.features !== null && !features) {
    return c.json({ error: 'features must be a value for every feature, or null' }, 400);
  }
  if (!mode && !agentHelp && body.features === undefined) {
    return c.json({ error: 'mode must be edit, view or off' }, 400);
  }
  const [row] = await db
    .update(boards)
    .set({
      ...(mode ? { shareMode: mode } : {}),
      ...(agentHelp ? { agentHelp } : {}),
      ...(body.features !== undefined ? { features } : {}),
    })
    .where(eq(boards.id, id))
    .returning(SHARE_COLUMNS);
  if (!row) return c.json({ error: 'not found' }, 404);
  if (mode) disconnectStudents(id);
  if (body.features !== undefined) notifyBoard(id, FEATURES_MESSAGE);
  return c.json(row as BoardShare);
});

// Revoke every link handed out so far: a new key, and everyone on the old one
// is dropped.
boardRoutes.post('/:id/access/reset', async (c) => {
  const id = c.req.param('id');
  const [row] = await db
    .update(boards)
    .set({ shareKey: sql`replace(gen_random_uuid()::text, '-', '')` })
    .where(eq(boards.id, id))
    .returning(SHARE_COLUMNS);
  if (!row) return c.json({ error: 'not found' }, 404);
  disconnectStudents(id);
  return c.json(row as BoardShare);
});

// Remove one student from the room, by the awareness client id the tutor's
// people list knows them by.
boardRoutes.post('/:id/remove', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { clientId?: unknown };
  if (typeof body.clientId !== 'number') {
    return c.json({ error: 'clientId required' }, 400);
  }
  if (!removeClient(c.req.param('id'), body.clientId)) {
    return c.json({ error: 'not connected' }, 404);
  }
  return c.json({ ok: true });
});

// Which boards have a student in them right now, and who on them is AFK.
// In-memory only, so it covers this server process — which is the only one the
// collab socket runs on.
boardRoutes.get('/live', async (c) => {
  const live = liveBoards();
  if (!live.length) return c.json(live);
  const owned = await db
    .select({ id: boards.id })
    .from(boards)
    .where(and(eq(boards.tutorId, currentTutor(c).id), inArray(boards.id, live.map((b) => b.id))));
  const ids = new Set(owned.map((row) => row.id));
  return c.json(live.filter((board) => ids.has(board.id)));
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
  const tutorId = currentTutor(c).id;
  const [row] = await db
    .insert(boards)
    .values({ id, name, tutorId, createdAt: now, updatedAt: now })
    // Only ever re-names this tutor's own board: an id another tutor holds is
    // a conflict, not a takeover.
    .onConflictDoUpdate({
      target: boards.id,
      set: { name, updatedAt: now },
      setWhere: eq(boards.tutorId, tutorId),
    })
    .returning();
  if (!row) return c.json({ error: 'board id taken' }, 409);
  return c.json(toMeta(row));
});

boardRoutes.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as {
    name?: string;
    favorite?: boolean;
  };
  const set: { name?: string; favorite?: boolean; updatedAt?: Date } = {};
  if (typeof body.name === 'string' && body.name.trim()) {
    set.name = body.name.trim();
    set.updatedAt = new Date();
  }
  if (typeof body.favorite === 'boolean') set.favorite = body.favorite;
  if (Object.keys(set).length === 0) {
    return c.json({ error: 'name or favorite required' }, 400);
  }
  const [row] = await db
    .update(boards)
    .set(set)
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

// The dated half of a board's notes: one entry per session, so the tutor can
// look back at what was covered last time. `boards.privateNotes` / `errorLog`
// above are the standing notes that outlive any one session.
const DATE = /^\d{4}-\d{2}-\d{2}$/;

boardRoutes.get('/:id/sessions', async (c) => {
  const rows = await db
    .select({ date: boardSessionNotes.date, body: boardSessionNotes.body })
    .from(boardSessionNotes)
    .where(eq(boardSessionNotes.boardId, c.req.param('id')))
    // Newest first — the last session is the one a tutor opens this for.
    .orderBy(desc(boardSessionNotes.date));
  return c.json(rows);
});

boardRoutes.put('/:id/sessions/:date', async (c) => {
  const id = c.req.param('id');
  const date = c.req.param('date');
  if (!DATE.test(date)) return c.json({ error: 'bad date' }, 400);
  const body = (await c.req.json().catch(() => ({}))) as { body?: string };
  if (typeof body.body !== 'string') return c.json({ error: 'body required' }, 400);
  const now = new Date();
  await db
    .insert(boardSessionNotes)
    .values({ boardId: id, date, body: body.body, updatedAt: now })
    .onConflictDoUpdate({
      target: [boardSessionNotes.boardId, boardSessionNotes.date],
      set: { body: body.body, updatedAt: now },
    });
  return c.json({ ok: true });
});

boardRoutes.delete('/:id/sessions/:date', async (c) => {
  await db
    .delete(boardSessionNotes)
    .where(
      and(
        eq(boardSessionNotes.boardId, c.req.param('id')),
        eq(boardSessionNotes.date, c.req.param('date')),
      ),
    );
  return c.json({ ok: true });
});

boardRoutes.delete('/:id', async (c) => {
  await deleteBoard(c.req.param('id'));
  return c.json({ ok: true });
});

/** A board and everything stored under it: documents, update log, notes. */
export async function deleteBoard(id: string): Promise<void> {
  // Close the live documents first: a client still editing would otherwise
  // keep appending update rows for a board that no longer exists.
  await closeBoardDocuments(id);
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
  // Each of those documents also has an append-only log of the updates written
  // since its snapshot, under the same names.
  await db
    .delete(boardDocumentUpdates)
    .where(
      or(
        eq(boardDocumentUpdates.documentName, id),
        sql`starts_with(${boardDocumentUpdates.documentName}, ${pageDocumentPrefix(id)})`,
      ),
    );
  await db
    .delete(boardSessionNotes)
    .where(eq(boardSessionNotes.boardId, id));
  await db.delete(boards).where(eq(boards.id, id));
}
