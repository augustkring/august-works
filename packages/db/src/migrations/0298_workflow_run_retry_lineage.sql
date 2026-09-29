ALTER TABLE "workflow_runs" ADD COLUMN "retry_of_run_id" uuid;
--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "idempotency_root_run_id" uuid;
--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_retry_of_run_id_workflow_runs_id_fk" FOREIGN KEY ("retry_of_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_idempotency_root_run_id_workflow_runs_id_fk" FOREIGN KEY ("idempotency_root_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "workflow_runs_company_retry_of_idx" ON "workflow_runs" USING btree ("company_id","retry_of_run_id","created_at");
--> statement-breakpoint
CREATE INDEX "workflow_runs_company_idempotency_root_idx" ON "workflow_runs" USING btree ("company_id","idempotency_root_run_id","created_at");
--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_retry_lineage_pair_check" CHECK ("workflow_runs"."retry_of_run_id" is null or "workflow_runs"."idempotency_root_run_id" is not null);
