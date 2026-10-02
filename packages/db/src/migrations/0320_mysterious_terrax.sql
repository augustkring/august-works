ALTER TABLE "workflow_waits" DROP CONSTRAINT IF EXISTS "workflow_waits_kind_check";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_step_runs_company_heartbeat_idx" ON "workflow_step_runs" USING btree ("company_id","heartbeat_run_id");--> statement-breakpoint
ALTER TABLE "workflow_waits" ADD CONSTRAINT "workflow_waits_kind_check" CHECK ("workflow_waits"."kind" in ('delay', 'human_interaction', 'external_callback', 'task_completion', 'external_agent_run', 'direct_agent_run', 'tool_action', 'subworkflow'));
