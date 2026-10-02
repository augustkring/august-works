ALTER TABLE "pipeline_stages" ADD COLUMN "workflow_execution_principal" jsonb;--> statement-breakpoint
ALTER TABLE "routines" ADD COLUMN "workflow_execution_principal" jsonb;