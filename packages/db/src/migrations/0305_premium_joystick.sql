ALTER TABLE "tool_invocations" ADD COLUMN "idempotency_request_hash" text;--> statement-breakpoint
ALTER TABLE "tool_invocations" ADD COLUMN "workflow_result_json" jsonb;