CREATE TABLE "knowledge_quality_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"finding_hash" text NOT NULL,
	"quality_dimension" text NOT NULL,
	"requirement_key" text NOT NULL,
	"severity" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"summary" text NOT NULL,
	"evidence_refs_json" jsonb NOT NULL,
	"rule_version" text NOT NULL,
	"resolution_ref" uuid,
	"resolution_reason" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_quality_findings_status_check" CHECK ("knowledge_quality_findings"."status" in ('open','acknowledged','resolved','suppressed_with_reason')),
	CONSTRAINT "knowledge_quality_findings_resolution_check" CHECK ("knowledge_quality_findings"."status" <> 'resolved' or ("knowledge_quality_findings"."resolution_ref" is not null and "knowledge_quality_findings"."resolved_at" is not null and "knowledge_quality_findings"."resolution_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "readiness_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"principal_id" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"action_class" text NOT NULL,
	"risk_class" text NOT NULL,
	"status" text NOT NULL,
	"requirement_snapshot_hash" text NOT NULL,
	"policy_snapshot_hash" text NOT NULL,
	"context_manifest_id" uuid,
	"requirement_snapshot_json" jsonb NOT NULL,
	"assessment_json" jsonb NOT NULL,
	"assessed_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "readiness_assessments_company_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "readiness_assessments_status_check" CHECK ("readiness_assessments"."status" in ('ready','ready_with_warnings','review_required','blocked','unknown')),
	CONSTRAINT "readiness_assessments_action_check" CHECK ("readiness_assessments"."action_class" in ('internal_draft','external_communication','data_mutation','financial_commitment','person_decision','destructive_action','restricted_processing')),
	CONSTRAINT "readiness_assessments_risk_check" CHECK ("readiness_assessments"."risk_class" in ('low','material','high')),
	CONSTRAINT "readiness_assessments_expiry_check" CHECK ("readiness_assessments"."expires_at" > "readiness_assessments"."assessed_at"),
	CONSTRAINT "readiness_assessments_hash_check" CHECK ("readiness_assessments"."requirement_snapshot_hash" ~ '^[0-9a-f]{64}$' and "readiness_assessments"."policy_snapshot_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "readiness_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"requirement_key" text NOT NULL,
	"name" text NOT NULL,
	"action_class" text NOT NULL,
	"version" integer NOT NULL,
	"criteria_json" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "readiness_requirements_version_check" CHECK ("readiness_requirements"."version" > 0),
	CONSTRAINT "readiness_requirements_criteria_check" CHECK (jsonb_typeof("readiness_requirements"."criteria_json") = 'array' and jsonb_array_length("readiness_requirements"."criteria_json") between 1 and 32)
);
--> statement-breakpoint
ALTER TABLE "knowledge_quality_findings" ADD CONSTRAINT "knowledge_quality_findings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_quality_findings" ADD CONSTRAINT "knowledge_quality_findings_company_assessment_fk" FOREIGN KEY ("company_id","assessment_id") REFERENCES "public"."readiness_assessments"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_assessments" ADD CONSTRAINT "readiness_assessments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_assessments" ADD CONSTRAINT "readiness_assessments_company_agent_fk" FOREIGN KEY ("company_id","agent_id") REFERENCES "public"."agents"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_assessments" ADD CONSTRAINT "readiness_assessments_company_manifest_fk" FOREIGN KEY ("company_id","context_manifest_id") REFERENCES "public"."context_manifests"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_requirements" ADD CONSTRAINT "readiness_requirements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_quality_findings_assessment_hash_uq" ON "knowledge_quality_findings" USING btree ("assessment_id","finding_hash");--> statement-breakpoint
CREATE INDEX "knowledge_quality_findings_company_status_idx" ON "knowledge_quality_findings" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "readiness_assessments_company_principal_idx" ON "readiness_assessments" USING btree ("company_id","principal_id","assessed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "readiness_requirements_company_key_version_uq" ON "readiness_requirements" USING btree ("company_id","requirement_key","version");--> statement-breakpoint
CREATE INDEX "readiness_requirements_company_action_idx" ON "readiness_requirements" USING btree ("company_id","action_class");