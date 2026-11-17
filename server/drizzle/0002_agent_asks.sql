CREATE TABLE "agent_asks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"board_id" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"color" text,
	"instruction" text NOT NULL,
	"kind" text NOT NULL,
	"result" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "agent_asks_board_idx" ON "agent_asks" USING btree ("board_id","created_at");