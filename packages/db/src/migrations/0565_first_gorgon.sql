CREATE TABLE "responsibility_scan_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"scan_run_id" uuid NOT NULL,
	"resource_kind" text NOT NULL,
	"resource_id" text NOT NULL,
	"source_version" text NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "responsibility_scan_candidates_kind_check" CHECK ("responsibility_scan_candidates"."resource_kind" in ('agent','deployment','workflow','workflow_run','routine','connector','metric','experiment','decision','approval','ai_use_case','tool_policy','skill_policy','billing','security_contact','support_incident_contact','support_case')),
	CONSTRAINT "responsibility_scan_candidates_source_version_check" CHECK ("responsibility_scan_candidates"."source_version" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "responsibility_scan_candidates_resource_id_check" CHECK ("responsibility_scan_candidates"."resource_id" <> '')
);
--> statement-breakpoint
CREATE TABLE "responsibility_scan_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"contract_version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"cursor_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_owner" text,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error_code" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "responsibility_scan_runs_status_check" CHECK ("responsibility_scan_runs"."status" in ('queued','running','complete','failed','abandoned')),
	CONSTRAINT "responsibility_scan_runs_lease_pair_check" CHECK (("responsibility_scan_runs"."lease_owner" is null) = ("responsibility_scan_runs"."lease_token" is null) and ("responsibility_scan_runs"."lease_token" is null) = ("responsibility_scan_runs"."lease_expires_at" is null)),
	CONSTRAINT "responsibility_scan_runs_attempt_check" CHECK ("responsibility_scan_runs"."attempt_count" >= 0),
	CONSTRAINT "responsibility_scan_runs_cursor_check" CHECK (jsonb_typeof("responsibility_scan_runs"."cursor_json") = 'object')
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "security_contact_user_id" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "support_incident_contact_user_id" text;--> statement-breakpoint
ALTER TABLE "responsibility_scan_candidates" ADD CONSTRAINT "responsibility_scan_candidates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responsibility_scan_candidates" ADD CONSTRAINT "responsibility_scan_candidates_scan_run_id_responsibility_scan_runs_id_fk" FOREIGN KEY ("scan_run_id") REFERENCES "public"."responsibility_scan_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responsibility_scan_runs" ADD CONSTRAINT "responsibility_scan_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "responsibility_scan_candidates_run_resource_uq" ON "responsibility_scan_candidates" USING btree ("scan_run_id","resource_kind","resource_id");--> statement-breakpoint
CREATE INDEX "responsibility_scan_candidates_read_idx" ON "responsibility_scan_candidates" USING btree ("company_id","scan_run_id","resource_kind","resource_id","expires_at");--> statement-breakpoint
CREATE INDEX "responsibility_scan_candidates_expiry_idx" ON "responsibility_scan_candidates" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "responsibility_scan_runs_one_active_per_company" ON "responsibility_scan_runs" USING btree ("company_id") WHERE "responsibility_scan_runs"."status" in ('queued','running','failed');--> statement-breakpoint
CREATE INDEX "responsibility_scan_runs_claim_idx" ON "responsibility_scan_runs" USING btree ("next_attempt_at","requested_at","company_id") WHERE "responsibility_scan_runs"."status" in ('queued','failed');--> statement-breakpoint
CREATE INDEX "responsibility_scan_runs_expiry_idx" ON "responsibility_scan_runs" USING btree ("expires_at");