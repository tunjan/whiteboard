CREATE TABLE "ai_models" (
	"job" text PRIMARY KEY NOT NULL,
	"model" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"board_id" text,
	"job" text NOT NULL,
	"model" text NOT NULL,
	"cost" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ai_usage_created_idx" ON "ai_usage" USING btree ("created_at");