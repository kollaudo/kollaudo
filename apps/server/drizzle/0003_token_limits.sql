ALTER TYPE "public"."token_scope" ADD VALUE 'policy';--> statement-breakpoint
ALTER TYPE "public"."token_scope" ADD VALUE 'override';--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "components" text[];--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "environments" text[];--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "build" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "token_id" uuid;--> statement-breakpoint
ALTER TABLE "test_runs" ADD COLUMN "token_id" uuid;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_token_id_api_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."api_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_token_id_api_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."api_tokens"("id") ON DELETE set null ON UPDATE no action;