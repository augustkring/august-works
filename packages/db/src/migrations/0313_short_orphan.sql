CREATE TABLE "workflow_run_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"workflow_run_id" uuid NOT NULL,
	"human_correction" boolean NOT NULL,
	"corrected_outputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reason" text NOT NULL,
	"reviewer" jsonb NOT NULL,
	"memory_record_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_run_reviews" ADD CONSTRAINT "workflow_run_reviews_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run_reviews" ADD CONSTRAINT "workflow_run_reviews_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_run_reviews_company_run_uq" ON "workflow_run_reviews" USING btree ("company_id","workflow_run_id");--> statement-breakpoint
CREATE INDEX "workflow_run_reviews_company_reviewed_idx" ON "workflow_run_reviews" USING btree ("company_id","reviewed_at");