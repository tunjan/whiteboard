import { customType, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

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
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** One row per board: the opaque binary Yjs document state. */
export const boardDocuments = pgTable('board_documents', {
  boardId: text('board_id').primaryKey(),
  data: bytea('data').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
