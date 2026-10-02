CREATE TYPE "public"."verdict_outcome" AS ENUM('pass', 'fail', 'unknown');--> statement-breakpoint
CREATE TABLE "verdicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"component" text NOT NULL,
	"environment" text NOT NULL,
	"version" text NOT NULL,
	"outcome" "verdict_outcome" NOT NULL,
	"evidence_outcome" "verdict_outcome" NOT NULL,
	"message" text NOT NULL,
	"policy_revision" integer,
	"require" text[] NOT NULL,
	"override_id" uuid,
	"token_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "verdicts" ADD CONSTRAINT "verdicts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verdicts" ADD CONSTRAINT "verdicts_override_id_overrides_id_fk" FOREIGN KEY ("override_id") REFERENCES "public"."overrides"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verdicts" ADD CONSTRAINT "verdicts_token_id_api_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."api_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "verdicts_project_id_created_at_index" ON "verdicts" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "verdicts_project_id_component_environment_version_index" ON "verdicts" USING btree ("project_id","component","environment","version");