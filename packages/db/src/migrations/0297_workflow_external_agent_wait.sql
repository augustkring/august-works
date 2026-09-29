ALTER TABLE "workflow_waits"
DROP CONSTRAINT IF EXISTS "workflow_waits_kind_check";
--> statement-breakpoint
ALTER TABLE "workflow_waits"
ADD CONSTRAINT "workflow_waits_kind_check"
CHECK ("workflow_waits"."kind" in ('delay', 'human_interaction', 'external_callback', 'task_completion', 'external_agent_run'));
