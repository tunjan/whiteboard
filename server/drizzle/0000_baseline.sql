-- Baseline: the schema as `db:push` had already created it. IF NOT EXISTS so a
-- database made that way adopts this history without failing; later
-- migrations are plain `drizzle-kit generate` output.
CREATE TABLE IF NOT EXISTS "board_document_updates" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"document_name" text NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "board_documents" (
	"board_id" text PRIMARY KEY NOT NULL,
	"data" "bytea" NOT NULL,
	"format" text DEFAULT 'v1' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "board_session_notes" (
	"board_id" text NOT NULL,
	"date" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_session_notes_board_id_date_pk" PRIMARY KEY("board_id","date")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "board_sessions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"board_id" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"color" text,
	"is_tutor" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edits" integer DEFAULT 0 NOT NULL,
	"drawings" integer DEFAULT 0 NOT NULL,
	"afk" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "boards" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"private_notes" text DEFAULT '' NOT NULL,
	"error_log" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"favorite" boolean DEFAULT false NOT NULL,
	"share_key" text DEFAULT replace(gen_random_uuid()::text, '-', '') NOT NULL,
	"share_mode" text DEFAULT 'edit' NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "board_document_updates_document_idx" ON "board_document_updates" USING btree ("document_name","seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "board_sessions_board_idx" ON "board_sessions" USING btree ("board_id","started_at");