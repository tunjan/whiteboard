import {
  bigserial,
  customType,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

// Postgres bytea — holds the opaque binary Yjs CRDT state (not shredded).
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

/** Board metadata only — never the CRDT content. */
export const boards = pgTable('boards', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  // Tutor-only notes about the student. Never exposed to student clients or the
  // Yjs doc — only served via the requireTutor-gated /notes endpoints.
  privateNotes: text('private_notes').notNull().default(''),
  // Tutor-only log of the student's recurring mistakes. Same gating as
  // privateNotes — served only by the requireTutor /notes endpoints.
  errorLog: text('error_log').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  // Bumped whenever a tutor opens the board — powers the dashboard's ordering.
  lastOpenedAt: timestamp('last_opened_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * One row per collaboration document: the opaque binary Yjs state.
 *
 * Not one row per board — a board is a small tree of documents. The board's own
 * document (named by its board id) holds the page registry and the board-level
 * shared state; each page's shapes live in a document named
 * `<boardId>/pages/<pageId>` (`pageDocumentName` in @whiteboard/shared), so a
 * client loads only the pages it opens. The column is still `board_id` because
 * renaming it would be a destructive `drizzle-kit push` against rows that hold
 * every board's content; the property name is what the code reads.
 */
export const boardDocuments = pgTable('board_documents', {
  documentName: text('board_id').primaryKey(),
  data: bytea('data').notNull(),
  // Which Yjs update encoding `data` holds. V1 keeps every superseded map write
  // at full width, so a board's row grows with edit *history* rather than with
  // its contents — a 50-shape page dragged for 600 frames encodes to ~593 KB in
  // V1 and ~6 KB in V2, and the gap widens without bound. New writes are always
  // 'v2'; the column exists so rows written before this change still load.
  format: text('format').notNull().default('v1'),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * The append-only tail of a document: the Yjs updates written since its
 * `board_documents` snapshot was last rewritten.
 *
 * A document is only ever appended to between two persistence ticks, so writing
 * its whole state each tick re-writes megabytes that did not change (see
 * `document-persistence.ts` for the measurements). Each tick appends one small
 * row here instead, and the snapshot is rebuilt — and these rows deleted — only
 * once the log grows past a bound. Loading a document replays the snapshot and
 * then these rows in `seq` order.
 */
export const boardDocumentUpdates = pgTable(
  'board_document_updates',
  {
    // Insertion order is replay order, so the sequence is the ordering key.
    seq: bigserial('seq', { mode: 'number' }).primaryKey(),
    documentName: text('document_name').notNull(),
    // Always a v2-encoded update, unlike `board_documents.data`: nothing
    // predates this table.
    data: bytea('data').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('board_document_updates_document_idx').on(
      table.documentName,
      table.seq,
    ),
  ],
);

/**
 * One tutor note per board per session date — the dated counterpart to
 * `boards.privateNotes` / `boards.errorLog`, which are the board's standing
 * notes. Same gating: served only by the requireTutor `/notes` endpoints, never
 * by the Yjs doc.
 *
 * `date` is a plain 'YYYY-MM-DD' string in the tutor's own calendar rather than
 * a timestamp: a session belongs to the day it was taught, and a timestamp would
 * drift across a timezone change into the wrong day.
 */
export const boardSessionNotes = pgTable(
  'board_session_notes',
  {
    boardId: text('board_id').notNull(),
    date: text('date').notNull(),
    body: text('body').notNull().default(''),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.boardId, table.date] })],
);
