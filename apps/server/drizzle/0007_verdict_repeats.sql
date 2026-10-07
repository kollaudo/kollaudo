ALTER TABLE "verdicts" ADD COLUMN "asked" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "verdicts" ADD COLUMN "last_asked_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
-- Verdicts given before were asked once, when they were given.
UPDATE "verdicts" SET "last_asked_at" = "created_at";
