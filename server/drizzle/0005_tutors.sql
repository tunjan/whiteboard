CREATE TABLE "tutors" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"features" jsonb,
	"plan" text DEFAULT 'free' NOT NULL,
	"stripe_customer_id" text,
	"session_version" integer DEFAULT 0 NOT NULL,
	"reset_token_hash" text,
	"reset_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tutors_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "tutor_id" text;