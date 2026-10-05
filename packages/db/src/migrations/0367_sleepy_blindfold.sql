CREATE TABLE "ai_use_case_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"use_case_id" uuid NOT NULL,
	"purpose_version" integer NOT NULL,
	"assessment" jsonb NOT NULL,
	"assessment_hash" text NOT NULL,
	"assessed_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_assessment_tenant_uq" UNIQUE("company_id","id")
);
--> statement-breakpoint
CREATE TABLE "ai_use_case_deployments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"use_case_id" uuid NOT NULL,
	"purpose_version" integer NOT NULL,
	"issue_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"purpose_hash" text NOT NULL,
	"authority_hash" text NOT NULL,
	"status" text DEFAULT 'review_required' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_deployment_tenant_uq" UNIQUE("company_id","id"),
	CONSTRAINT "ai_deployment_state_check" CHECK ("ai_use_case_deployments"."status" in ('active','review_required','suspended','retired'))
);
--> statement-breakpoint
CREATE TABLE "ai_use_case_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"use_case_id" uuid NOT NULL,
	"purpose_version" integer NOT NULL,
	"purpose" jsonb NOT NULL,
	"purpose_hash" text NOT NULL,
	"oversight_profile_id" uuid NOT NULL,
	"oversight_profile_hash" text NOT NULL,
	"change_classification" text NOT NULL,
	"change_reason" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_use_case_purpose_version_uq" UNIQUE("company_id","use_case_id","purpose_version")
);
--> statement-breakpoint
CREATE TABLE "ai_use_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"key" text NOT NULL,
	"purpose_version" integer DEFAULT 1 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"owner_user_id" text NOT NULL,
	"approved_at" timestamp with time zone,
	"next_review_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_use_case_tenant_uq" UNIQUE("company_id","id"),
	CONSTRAINT "ai_use_case_company_key_uq" UNIQUE("company_id","key"),
	CONSTRAINT "ai_use_case_state_check" CHECK ("ai_use_cases"."status" in ('draft','assessing','approved','restricted','suspended','retired')),
	CONSTRAINT "ai_use_case_version_check" CHECK ("ai_use_cases"."purpose_version">0 and "ai_use_cases"."version">0)
);
--> statement-breakpoint
CREATE TABLE "governance_obligations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"obligation" jsonb NOT NULL,
	"obligation_hash" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"last_reviewed_at" timestamp with time zone NOT NULL,
	"next_review_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "governance_obligation_tenant_uq" UNIQUE("company_id","id")
);
--> statement-breakpoint
CREATE TABLE "governance_stop_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"deployment_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_until" timestamp with time zone,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "governance_stop_run_uq" UNIQUE("company_id","run_id"),
	CONSTRAINT "governance_stop_state_check" CHECK ("governance_stop_actions"."status" in ('queued','delivering','delivered')),
	CONSTRAINT "governance_stop_attempts_check" CHECK ("governance_stop_actions"."attempts">=0)
);
--> statement-breakpoint
CREATE TABLE "human_oversight_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"profile" jsonb NOT NULL,
	"profile_hash" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oversight_profile_tenant_uq" UNIQUE("company_id","id"),
	CONSTRAINT "oversight_profile_state_check" CHECK ("human_oversight_profiles"."status" in ('active','revoked'))
);
--> statement-breakpoint
ALTER TABLE "ai_use_case_assessments" ADD CONSTRAINT "ai_use_case_assessments_company_id_use_case_id_purpose_version_ai_use_case_versions_company_id_use_case_id_purpose_version_fk" FOREIGN KEY ("company_id","use_case_id","purpose_version") REFERENCES "public"."ai_use_case_versions"("company_id","use_case_id","purpose_version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_use_case_deployments" ADD CONSTRAINT "ai_use_case_deployments_company_id_use_case_id_purpose_version_ai_use_case_versions_company_id_use_case_id_purpose_version_fk" FOREIGN KEY ("company_id","use_case_id","purpose_version") REFERENCES "public"."ai_use_case_versions"("company_id","use_case_id","purpose_version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_use_case_deployments" ADD CONSTRAINT "ai_use_case_deployments_company_id_issue_id_issues_company_id_id_fk" FOREIGN KEY ("company_id","issue_id") REFERENCES "public"."issues"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_use_case_deployments" ADD CONSTRAINT "ai_use_case_deployments_company_id_agent_id_agents_company_id_id_fk" FOREIGN KEY ("company_id","agent_id") REFERENCES "public"."agents"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_use_case_versions" ADD CONSTRAINT "ai_use_case_versions_company_id_use_case_id_ai_use_cases_company_id_id_fk" FOREIGN KEY ("company_id","use_case_id") REFERENCES "public"."ai_use_cases"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_use_case_versions" ADD CONSTRAINT "ai_use_case_versions_company_id_oversight_profile_id_human_oversight_profiles_company_id_id_fk" FOREIGN KEY ("company_id","oversight_profile_id") REFERENCES "public"."human_oversight_profiles"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_use_cases" ADD CONSTRAINT "ai_use_cases_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "governance_obligations" ADD CONSTRAINT "governance_obligations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "governance_stop_actions" ADD CONSTRAINT "governance_stop_actions_company_id_deployment_id_ai_use_case_deployments_company_id_id_fk" FOREIGN KEY ("company_id","deployment_id") REFERENCES "public"."ai_use_case_deployments"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "governance_stop_actions" ADD CONSTRAINT "governance_stop_actions_company_id_run_id_heartbeat_runs_company_id_id_fk" FOREIGN KEY ("company_id","run_id") REFERENCES "public"."heartbeat_runs"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "human_oversight_profiles" ADD CONSTRAINT "human_oversight_profiles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_assessment_case_idx" ON "ai_use_case_assessments" USING btree ("company_id","use_case_id","purpose_version");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_deployment_task_live_uq" ON "ai_use_case_deployments" USING btree ("company_id","issue_id") WHERE "ai_use_case_deployments"."status"<>'retired';--> statement-breakpoint
CREATE INDEX "ai_use_case_review_idx" ON "ai_use_cases" USING btree ("status","next_review_at");--> statement-breakpoint
CREATE INDEX "governance_obligation_review_idx" ON "governance_obligations" USING btree ("next_review_at");