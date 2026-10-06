CREATE TABLE "foundation_bootstrap_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"bootstrap_run_id" uuid NOT NULL,
	"foundation_key" text NOT NULL,
	"version" integer NOT NULL,
	"candidate_json" jsonb NOT NULL,
	"evidence_refs_json" jsonb NOT NULL,
	"status" text DEFAULT 'candidate' NOT NULL,
	"foundation_document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "foundation_bootstrap_candidates_status_check" CHECK ("foundation_bootstrap_candidates"."status" in ('candidate','superseded','proposed','rejected'))
);
--> statement-breakpoint
CREATE TABLE "foundation_bootstrap_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"started_by" text NOT NULL,
	"responsible_user_id" text,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"query" text NOT NULL,
	"status" text DEFAULT 'awaiting_candidates' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"source_scope_json" jsonb NOT NULL,
	"answers_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_manifest_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "foundation_bootstrap_runs_company_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "foundation_bootstrap_runs_status_check" CHECK ("foundation_bootstrap_runs"."status" in ('awaiting_candidates','needs_answers','ready_for_review','proposals_created','cancelled','failed')),
	CONSTRAINT "foundation_bootstrap_runs_version_check" CHECK ("foundation_bootstrap_runs"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "foundation_bootstrap_candidates" ADD CONSTRAINT "foundation_bootstrap_candidates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundation_bootstrap_candidates" ADD CONSTRAINT "foundation_bootstrap_candidates_foundation_document_id_foundation_documents_id_fk" FOREIGN KEY ("foundation_document_id") REFERENCES "public"."foundation_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundation_bootstrap_candidates" ADD CONSTRAINT "foundation_bootstrap_candidates_run_fk" FOREIGN KEY ("company_id","bootstrap_run_id") REFERENCES "public"."foundation_bootstrap_runs"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundation_bootstrap_runs" ADD CONSTRAINT "foundation_bootstrap_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundation_bootstrap_runs" ADD CONSTRAINT "foundation_bootstrap_runs_agent_fk" FOREIGN KEY ("company_id","agent_id") REFERENCES "public"."agents"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundation_bootstrap_runs" ADD CONSTRAINT "foundation_bootstrap_runs_task_fk" FOREIGN KEY ("company_id","task_id") REFERENCES "public"."issues"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundation_bootstrap_runs" ADD CONSTRAINT "foundation_bootstrap_runs_manifest_fk" FOREIGN KEY ("company_id","source_manifest_id") REFERENCES "public"."context_manifests"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "foundation_bootstrap_candidates_version_uq" ON "foundation_bootstrap_candidates" USING btree ("bootstrap_run_id","foundation_key","version");--> statement-breakpoint
CREATE UNIQUE INDEX "foundation_bootstrap_runs_request_uq" ON "foundation_bootstrap_runs" USING btree ("company_id","started_by","idempotency_key");--> statement-breakpoint
CREATE INDEX "foundation_bootstrap_runs_owner_idx" ON "foundation_bootstrap_runs" USING btree ("company_id","started_by","created_at");