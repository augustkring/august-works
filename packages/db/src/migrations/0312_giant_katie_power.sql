ALTER TABLE "workflow_waits" DROP CONSTRAINT "workflow_waits_kind_check";--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "memory_record_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "parent_workflow_run_id" uuid;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "parent_node_id" text;--> statement-breakpoint
ALTER TABLE "workflow_step_runs" ADD COLUMN "child_workflow_run_id" uuid;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_parent_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("parent_workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_step_runs" ADD CONSTRAINT "workflow_step_runs_child_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("child_workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_waits" ADD CONSTRAINT "workflow_waits_kind_check" CHECK ("workflow_waits"."kind" in ('delay', 'human_interaction', 'external_callback', 'task_completion', 'external_agent_run', 'tool_action', 'subworkflow'));