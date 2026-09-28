CREATE TABLE "workflow_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "workflow_id" uuid NOT NULL,
  "workflow_revision_id" uuid NOT NULL,
  "trigger_id" uuid,
  "status" text DEFAULT 'queued' NOT NULL,
  "source" text DEFAULT 'manual' NOT NULL,
  "trigger_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "responsible_user_id" text,
  "idempotency_key" text,
  "correlation_id" text,
  "execution_owner_id" text,
  "lease_expires_at" timestamp with time zone,
  "owner_heartbeat_at" timestamp with time zone,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "failure_code" text,
  "failure_message" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workflow_runs_status_check" CHECK ("workflow_runs"."status" in ('queued', 'running', 'waiting', 'recovering', 'cancelling', 'succeeded', 'failed', 'cancelled')),
  CONSTRAINT "workflow_runs_source_check" CHECK ("workflow_runs"."source" in ('manual', 'schedule', 'webhook', 'api', 'connector_event', 'routine', 'pipeline', 'task')),
  CONSTRAINT "workflow_runs_lease_pair_check" CHECK (("workflow_runs"."execution_owner_id" is null) = ("workflow_runs"."lease_expires_at" is null)),
  CONSTRAINT "workflow_runs_terminal_lease_check" CHECK ("workflow_runs"."status" not in ('succeeded', 'failed', 'cancelled') or ("workflow_runs"."execution_owner_id" is null and "workflow_runs"."lease_expires_at" is null)),
  CONSTRAINT "workflow_runs_terminal_finished_check" CHECK ("workflow_runs"."status" not in ('succeeded', 'failed', 'cancelled') or "workflow_runs"."finished_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "workflow_step_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "workflow_run_id" uuid NOT NULL,
  "node_id" text NOT NULL,
  "attempt" integer DEFAULT 1 NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "input_json" jsonb,
  "output_json" jsonb,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "duration_ms" integer,
  "agent_id" uuid,
  "heartbeat_run_id" uuid,
  "tool_invocation_id" uuid,
  "automation_artifact_version_id" uuid,
  "error_code" text,
  "error_message" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workflow_step_runs_status_check" CHECK ("workflow_step_runs"."status" in ('pending', 'running', 'waiting', 'retry_scheduled', 'retried', 'succeeded', 'failed', 'skipped', 'cancelling', 'cancelled')),
  CONSTRAINT "workflow_step_runs_attempt_check" CHECK ("workflow_step_runs"."attempt" >= 1),
  CONSTRAINT "workflow_step_runs_duration_check" CHECK ("workflow_step_runs"."duration_ms" is null or "workflow_step_runs"."duration_ms" >= 0),
  CONSTRAINT "workflow_step_runs_terminal_finished_check" CHECK ("workflow_step_runs"."status" not in ('retried', 'succeeded', 'failed', 'skipped', 'cancelled') or "workflow_step_runs"."finished_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workflow_revision_id_workflow_revisions_id_fk" FOREIGN KEY ("workflow_revision_id") REFERENCES "public"."workflow_revisions"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workflow_step_runs" ADD CONSTRAINT "workflow_step_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workflow_step_runs" ADD CONSTRAINT "workflow_step_runs_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workflow_step_runs" ADD CONSTRAINT "workflow_step_runs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workflow_step_runs" ADD CONSTRAINT "workflow_step_runs_heartbeat_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("heartbeat_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "workflow_runs_company_workflow_created_idx" ON "workflow_runs" USING btree ("company_id","workflow_id","created_at");
--> statement-breakpoint
CREATE INDEX "workflow_runs_company_status_created_idx" ON "workflow_runs" USING btree ("company_id","status","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_runs_company_idempotency_uq" ON "workflow_runs" USING btree ("company_id","idempotency_key") WHERE "workflow_runs"."idempotency_key" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_step_runs_run_node_attempt_uq" ON "workflow_step_runs" USING btree ("workflow_run_id","node_id","attempt");
--> statement-breakpoint
CREATE INDEX "workflow_step_runs_company_run_status_idx" ON "workflow_step_runs" USING btree ("company_id","workflow_run_id","status");
