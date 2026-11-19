import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  customType,
  doublePrecision,
  index,
  integer,
  jsonb,
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

/**
 * A tutor's account. A self-hosted server has one, made from `TUTOR_PASSWORD`
 * on first boot (`auth/tutors.ts`); the hosted one lets tutors sign up.
 */
export const tutors = pgTable('tutors', {
  id: text('id').primaryKey(),
  // Lowercased. A self-hosted admin's is `TUTOR_EMAIL`, `tutor` by default.
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  // `scrypt$<salt>$<hash>`, see `auth/password.ts`.
  passwordHash: text('password_hash').notNull(),
  // The operator: picks the AI models and gets AI without a plan.
  isAdmin: boolean('is_admin').notNull().default(false),
  // Default `FeatureSet` for this tutor's boards, or null for everything.
  features: jsonb('features'),
  // 'free' | 'pro', kept in step with Stripe by the billing webhook.
  plan: text('plan').notNull().default('free'),
  stripeCustomerId: text('stripe_customer_id'),
  // Bumped on a password change: every session signed before it stops working.
  sessionVersion: integer('session_version').notNull().default(0),
  // sha256 of the emailed reset token, and when it stops working.
  resetTokenHash: text('reset_token_hash'),
  resetExpiresAt: timestamp('reset_expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Board metadata only — never the CRDT content. */
export const boards = pgTable('boards', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  // The tutor who owns it; null only for the public demo board.
  tutorId: text('tutor_id'),
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
  // Pinned in the tutor's library. Server-side so every device agrees.
  favorite: boolean('favorite').notNull().default(false),
  // The secret in a student's link (`?k=`). Rotating it is how a tutor revokes
  // every link handed out so far. `gen_random_uuid` draws from the server's
  // strong random source and needs no extension.
  shareKey: text('share_key')
    .notNull()
    .default(sql`replace(gen_random_uuid()::text, '-', '')`),
  // What that link grants: 'edit', 'view' or 'off' (see boards/access.ts).
  shareMode: text('share_mode').notNull().default('edit'),
  // What "Ask the board" does for students: 'full', 'hints' or 'off'.
  agentHelp: text('agent_help').notNull().default('full'),
  // This board's own feature set (`FeatureSet` in @whiteboard/shared), or null
  // to follow the tutor's defaults in `app_settings`.
  features: jsonb('features'),
});

/**
 * Instance-wide settings, one JSON value per key: `features` (the tutor's
 * default `FeatureSet`) and `demo` (the current public demo board).
 */
export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
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

/**
 * One row per connection to a board's collaboration room: who joined, when, and
 * how long they stayed. The only record of app usage — everything else stored
 * is board *content*, which says nothing about who turned up or when.
 *
 * Written by `session-tracking.ts` off the Hocuspocus connection hooks, not by
 * the client, so a student cannot inflate or suppress their own row. `name` and
 * `color` are the identity that client published over awareness (see
 * `identity.ts`): self-entered, never verified — treat them as a label, not a
 * credential. `isTutor` is the one identity fact the server decides for itself,
 * from the session cookie on the upgrade request.
 *
 * Only the board document is tracked. A client opens a provider per resident
 * page over the same socket, and counting those would turn "opened three pages"
 * into three sessions.
 */
export const boardSessions = pgTable(
  'board_sessions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    boardId: text('board_id').notNull(),
    name: text('name').notNull().default(''),
    color: text('color'),
    isTutor: boolean('is_tutor').notNull().default(false),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Bumped while the connection lives, so an abandoned row left by a crashed
    // process still bounds the session rather than running to the end of time.
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Document updates received from this connection — the difference between
    // sitting on a board and working on one.
    edits: integer('edits').notNull().default(0),
    // Shapes this connection added. An edit is a sync message, and one stroke
    // streams dozens; a drawing is what the tutor would count on the page.
    drawings: integer('drawings').notNull().default(0),
    // Stretches with no input from this connection past the AFK grace, as
    // [startMs, endMs] pairs — a tab left open is not time spent on the board.
    afk: jsonb('afk').$type<[number, number][]>().notNull().default([]),
  },
  (table) => [
    index('board_sessions_board_idx').on(table.boardId, table.startedAt),
  ],
);

/**
 * The tutor's model choice per AI job (`AiJob` in @whiteboard/shared). A job
 * with no row runs on its `env.ts` default, so an empty table is the old
 * behaviour exactly.
 */
export const aiModels = pgTable('ai_models', {
  job: text('job').primaryKey(),
  model: text('model').notNull(),
});

/**
 * One row per OpenRouter request, with what it cost — the bill broken down by
 * board and model for the analytics page. `boardId` is the `X-Board-Id` the
 * request was authorised against; null only for a request that carried none.
 */
export const aiUsage = pgTable(
  'ai_usage',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    boardId: text('board_id'),
    job: text('job').notNull(),
    model: text('model').notNull(),
    // USD as OpenRouter reported it in `usage.cost`; 0 when it reported none.
    cost: doublePrecision('cost').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('ai_usage_created_idx').on(table.createdAt)],
);

/**
 * What students asked the board agent, for the tutor: one row per answered
 * instruction from an edit-link client (the tutor's own are not kept). `name`
 * and `color` are what that client published, as in `boardSessions` — a
 * label, not a credential.
 */
export const agentAsks = pgTable(
  'agent_asks',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    boardId: text('board_id').notNull(),
    name: text('name').notNull().default(''),
    color: text('color'),
    instruction: text('instruction').notNull(),
    // 'done' | 'reply' | 'nothing' — `AgentAsk['kind']`.
    kind: text('kind').notNull(),
    result: text('result').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('agent_asks_board_idx').on(table.boardId, table.createdAt)],
);
