CREATE TYPE "public"."bug_state" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TABLE "bug_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"component_id" uuid NOT NULL,
	"key" text NOT NULL,
	"url" text NOT NULL,
	"state" "bug_state" DEFAULT 'open' NOT NULL,
	"test" text NOT NULL,
	"token_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bug_links_componentId_key_test_unique" UNIQUE("component_id","key","test")
);
--> statement-breakpoint
ALTER TABLE "bug_links" ADD CONSTRAINT "bug_links_component_id_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."components"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bug_links" ADD CONSTRAINT "bug_links_token_id_api_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."api_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bug_links_component_id_state_index" ON "bug_links" USING btree ("component_id","state");