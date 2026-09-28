CREATE TABLE "workflow_waits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "workflow_run_id" uuid NOT NULL,
  "node_id" text NOT NULL,
  "wait_key" text NOT NULL,
  "kind" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "wake_at" timestamp with time zone,
  "timeout_at" timestamp with time zone,
  "reference_type" text,
  "reference_id" text,
  "signal_token_hash" text,
  "resolution_json" jsonb,
  "resolved_by_type" text,
  "resolved_by_id" text,
  "resolved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workflow_waits_kind_check" CHECK ("workflow_waits"."kind" in ('delay', 'human_interaction', 'external_callback', 'task_completion')),
  CONSTRAINT "workflow_waits_status_check" CHECK ("workflow_waits"."status" in ('active', 'resolved', 'timed_out', 'cancelled')),
  CONSTRAINT "workflow_waits_terminal_resolution_check" CHECK (("workflow_waits"."status" = 'active' and "workflow_waits"."resolved_at" is null) or ("workflow_waits"."status" <> 'active' and "workflow_waits"."resolved_at" is not null)),
  CONSTRAINT "workflow_waits_delay_wake_check" CHECK ("workflow_waits"."kind" <> 'delay' or "workflow_waits"."wake_at" is not null),
  CONSTRAINT "workflow_waits_callback_signal_check" CHECK ("workflow_waits"."kind" <> 'external_callback' or "workflow_waits"."signal_token_hash" is not null)
);
--> statement-breakpoint
ALTER TABLE "workflow_waits" ADD CONSTRAINT "workflow_waits_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workflow_waits" ADD CONSTRAINT "workflow_waits_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "workflow_waits_company_run_status_idx" ON "workflow_waits" USING btree ("company_id","workflow_run_id","status");
--> statement-breakpoint
CREATE INDEX "workflow_waits_status_wake_idx" ON "workflow_waits" USING btree ("status","wake_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_waits_run_node_active_uq" ON "workflow_waits" USING btree ("workflow_run_id","node_id","wait_key") WHERE "workflow_waits"."status" = 'active';
--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_waits_signal_token_hash_uq" ON "workflow_waits" USING btree ("signal_token_hash") WHERE "workflow_waits"."signal_token_hash" is not null;
