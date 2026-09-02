import {
  customType,
  pgTable,
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
