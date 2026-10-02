ALTER TABLE "workflow_waits" DROP CONSTRAINT "workflow_waits_kind_check";--> statement-breakpoint
ALTER TABLE "tool_invocations" ADD COLUMN "workflow_run_id" uuid;--> statement-breakpoint
ALTER TABLE "tool_invocations" ADD COLUMN "workflow_node_id" text;--> statement-breakpoint
ALTER TABLE "tool_invocations" ADD CONSTRAINT "tool_invocations_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_waits" ADD CONSTRAINT "workflow_waits_kind_check" CHECK ("workflow_waits"."kind" in ('delay', 'human_interaction', 'external_callback', 'task_completion', 'external_agent_run', 'tool_action'));