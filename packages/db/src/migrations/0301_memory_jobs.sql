CREATE TABLE "memory_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "operation_type" text NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "job_key" text NOT NULL,
  "attempt_number" integer DEFAULT 1 NOT NULL,
  "retry_of_job_id" uuid,
  "source_heartbeat_run_id" uuid,
  "source_memory_record_id" uuid,
  "source_ref_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "execution_owner_id" text,
  "lease_expires_at" timestamp with time zone,
  "submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "result_summary" text,
  "result_json" jsonb,
  "error_code" text,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "memory_jobs_operation_type_check" CHECK ("operation_type" in ('capture','dedupe','compaction','reflection','index_refresh','retention')),
  CONSTRAINT "memory_jobs_status_check" CHECK ("status" in ('queued','running','succeeded','failed','cancelled')),
  CONSTRAINT "memory_jobs_attempt_number_check" CHECK ("attempt_number" >= 1),
  CONSTRAINT "memory_jobs_retry_lineage_check" CHECK (("attempt_number" = 1 and "retry_of_job_id" is null) or ("attempt_number" > 1 and "retry_of_job_id" is not null)),
  CONSTRAINT "memory_jobs_retry_not_self_check" CHECK ("retry_of_job_id" is null or "retry_of_job_id" <> "id"),
  CONSTRAINT "memory_jobs_lease_pair_check" CHECK (("execution_owner_id" is null) = ("lease_expires_at" is null)),
  CONSTRAINT "memory_jobs_terminal_lease_check" CHECK ("status" not in ('succeeded','failed','cancelled') or ("execution_owner_id" is null and "lease_expires_at" is null)),
  CONSTRAINT "memory_jobs_status_lease_check" CHECK (("status" = 'running' and "execution_owner_id" is not null and "lease_expires_at" is not null) or ("status" <> 'running' and "execution_owner_id" is null and "lease_expires_at" is null)),
  CONSTRAINT "memory_jobs_terminal_finished_check" CHECK ("status" not in ('succeeded','failed','cancelled') or "finished_at" is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "memory_jobs_company_id_id_uq" ON "memory_jobs" ("company_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "heartbeat_runs_company_id_id_uq" ON "heartbeat_runs" ("company_id","id");
--> statement-breakpoint
ALTER TABLE "memory_jobs" ADD CONSTRAINT "memory_jobs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "memory_jobs" ADD CONSTRAINT "memory_jobs_company_retry_of_fk" FOREIGN KEY ("company_id","retry_of_job_id") REFERENCES "public"."memory_jobs"("company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "memory_jobs" ADD CONSTRAINT "memory_jobs_company_source_run_fk" FOREIGN KEY ("company_id","source_heartbeat_run_id") REFERENCES "public"."heartbeat_runs"("company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "memory_jobs" ADD CONSTRAINT "memory_jobs_company_source_memory_record_fk" FOREIGN KEY ("company_id","source_memory_record_id") REFERENCES "public"."memory_records"("company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "memory_jobs_company_key_attempt_uq" ON "memory_jobs" ("company_id","job_key","attempt_number");
--> statement-breakpoint
CREATE INDEX "memory_jobs_company_status_submitted_idx" ON "memory_jobs" ("company_id","status","submitted_at");
--> statement-breakpoint
CREATE INDEX "memory_jobs_queue_idx" ON "memory_jobs" ("submitted_at") WHERE "status" = 'queued';
--> statement-breakpoint
CREATE INDEX "memory_jobs_running_lease_idx" ON "memory_jobs" ("lease_expires_at") WHERE "status" = 'running';
--> statement-breakpoint
CREATE INDEX "memory_jobs_source_run_idx" ON "memory_jobs" ("company_id","source_heartbeat_run_id","operation_type");
--> statement-breakpoint
CREATE INDEX "memory_jobs_retry_of_idx" ON "memory_jobs" ("retry_of_job_id");
