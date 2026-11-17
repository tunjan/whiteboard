import { Hono } from 'hono';
import { count, desc, gte, sql } from 'drizzle-orm';
import { isAnalyticsRange, type AgentAsk } from '@whiteboard/shared';
import { requireTutor } from '../auth/middleware';
import { db } from '../db/client';
import {
  agentAsks,
  aiUsage,
  boardDocumentUpdates,
  boardDocuments,
  boardSessionNotes,
  boardSessions,
  boards,
} from '../db/schema';
import { type BoardContent, aggregate, rangeStart } from './aggregate';

export const analyticsRoutes = new Hono();

// Everything here is the tutor's view of their practice, including students'
// names and when they turned up. Never reachable from a board client.
analyticsRoutes.use('*', requireTutor);

const DEFAULT_RANGE = 30;

// ponytail: a per-board cap applied after one range query; page the list
// (or group in SQL) if a year of a busy class ever makes the query heavy.
const MAX_ASKS_PER_BOARD = 100;

/** A document name's board id: `<boardId>/pages/<pageId>` or the board itself. */
const boardIdExpr = sql<string>`split_part(${boardDocuments.documentName}, '/pages/', 1)`;
const updatesBoardIdExpr = sql<string>`split_part(${boardDocumentUpdates.documentName}, '/pages/', 1)`;

analyticsRoutes.get('/', async (c) => {
  const asked = Number(c.req.query('days') ?? DEFAULT_RANGE);
  const days = isAnalyticsRange(asked) ? asked : DEFAULT_RANGE;
  const now = new Date();
  const from = rangeStart(days, now);

  const [
    boardRows,
    sessionRows,
    lastSeenRows,
    docRows,
    updateRows,
    noteRows,
    aiBoardRows,
    aiModelRows,
    askRows,
  ] = await Promise.all([
      db
        .select({
          id: boards.id,
          name: boards.name,
          createdAt: boards.createdAt,
          lastOpenedAt: boards.lastOpenedAt,
        })
        .from(boards),
      db
        .select({
          boardId: boardSessions.boardId,
          name: boardSessions.name,
          color: boardSessions.color,
          isTutor: boardSessions.isTutor,
          startedAt: boardSessions.startedAt,
          lastSeenAt: boardSessions.lastSeenAt,
          edits: boardSessions.edits,
          drawings: boardSessions.drawings,
          afk: boardSessions.afk,
        })
        .from(boardSessions)
        // A visit that began before the range but ran into it still belongs to
        // it, so the filter is on where it ended.
        .where(gte(boardSessions.lastSeenAt, from)),
      // When a student was last on each board, over all of history — the row
      // above is range-bound, and "quiet since June" is the question the range
      // cannot answer about itself.
      db
        .select({
          boardId: boardSessions.boardId,
          lastSeenAt: sql<Date | null>`max(${boardSessions.lastSeenAt}) filter (where not ${boardSessions.isTutor})`,
        })
        .from(boardSessions)
        .groupBy(boardSessions.boardId),
      // Stored size and page count, from the snapshot rows...
      db
        .select({
          boardId: boardIdExpr,
          bytes: sql<number>`sum(octet_length(${boardDocuments.data}))::int`,
          pages: sql<number>`count(*) filter (where ${boardDocuments.documentName} like '%/pages/%')::int`,
        })
        .from(boardDocuments)
        .groupBy(boardIdExpr),
      // ...plus the append-only tail each snapshot has not absorbed yet.
      db
        .select({
          boardId: updatesBoardIdExpr,
          bytes: sql<number>`sum(octet_length(${boardDocumentUpdates.data}))::int`,
        })
        .from(boardDocumentUpdates)
        .groupBy(updatesBoardIdExpr),
      db
        .select({
          boardId: boardSessionNotes.boardId,
          notes: count(),
        })
        .from(boardSessionNotes)
        .groupBy(boardSessionNotes.boardId),
      // AI spend in range, by the board it was made for...
      db
        .select({
          boardId: aiUsage.boardId,
          requests: sql<number>`count(*)::int`,
          cost: sql<number>`sum(${aiUsage.cost})::float8`,
        })
        .from(aiUsage)
        .where(gte(aiUsage.createdAt, from))
        .groupBy(aiUsage.boardId),
      // ...and by the model that made it.
      db
        .select({
          job: aiUsage.job,
          model: aiUsage.model,
          requests: sql<number>`count(*)::int`,
          cost: sql<number>`sum(${aiUsage.cost})::float8`,
        })
        .from(aiUsage)
        .where(gte(aiUsage.createdAt, from))
        .groupBy(aiUsage.job, aiUsage.model)
        .orderBy(sql`sum(${aiUsage.cost}) desc`),
      // What students asked the board agent, newest first.
      db
        .select()
        .from(agentAsks)
        .where(gte(agentAsks.createdAt, from))
        .orderBy(desc(agentAsks.createdAt)),
    ]);

  const asksByBoard = new Map<string, AgentAsk[]>();
  for (const row of askRows) {
    const list = asksByBoard.get(row.boardId) ?? [];
    if (list.length >= MAX_ASKS_PER_BOARD) continue;
    list.push({
      name: row.name,
      color: row.color,
      at: new Date(row.createdAt).getTime(),
      instruction: row.instruction,
      kind: row.kind as AgentAsk['kind'],
      result: row.result,
    });
    asksByBoard.set(row.boardId, list);
  }

  const lastStudentAt = new Map<string, number>();
  for (const row of lastSeenRows) {
    if (row.lastSeenAt)
      lastStudentAt.set(row.boardId, new Date(row.lastSeenAt).getTime());
  }

  const content = new Map<string, BoardContent>();
  const contentFor = (boardId: string): BoardContent => {
    let entry = content.get(boardId);
    if (!entry) {
      entry = { pages: 0, bytes: 0, notedSessions: 0 };
      content.set(boardId, entry);
    }
    return entry;
  };
  for (const row of docRows) {
    const entry = contentFor(row.boardId);
    entry.bytes += Number(row.bytes ?? 0);
    entry.pages += Number(row.pages ?? 0);
  }
  for (const row of updateRows) {
    contentFor(row.boardId).bytes += Number(row.bytes ?? 0);
  }
  for (const row of noteRows) {
    contentFor(row.boardId).notedSessions = Number(row.notes ?? 0);
  }

  return c.json(
    aggregate({
      boards: boardRows,
      sessions: sessionRows,
      content,
      lastStudentAt,
      ai: {
        byBoard: new Map(
          aiBoardRows
            .filter((row) => row.boardId)
            .map((row) => [
              row.boardId as string,
              { requests: Number(row.requests), cost: Number(row.cost) },
            ]),
        ),
        byModel: aiModelRows.map((row) => ({
          ...row,
          requests: Number(row.requests),
          cost: Number(row.cost),
        })),
      },
      agentAsks: asksByBoard,
      days,
      now,
    }),
  );
});
