ALTER TABLE "workflow_step_runs" ADD COLUMN "task_result_json" jsonb;--> statement-breakpoint
ALTER TABLE "workflow_step_runs" ADD COLUMN "task_result_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workflow_step_runs" ADD COLUMN "task_result_run_id" uuid;--> statement-breakpoint
ALTER TABLE "workflow_step_runs" ADD CONSTRAINT "workflow_step_runs_task_result_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("task_result_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;