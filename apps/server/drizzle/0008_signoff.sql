ALTER TYPE "public"."token_scope" ADD VALUE 'signoff';--> statement-breakpoint
ALTER TABLE "test_runs" ADD COLUMN "signoff" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "test_runs" ADD COLUMN "note" text;