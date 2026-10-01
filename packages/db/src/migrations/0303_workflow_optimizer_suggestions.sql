CREATE TABLE "workflow_optimizer_suggestions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "workflow_id" uuid NOT NULL,
  "workflow_revision_id" uuid NOT NULL,
  "signature_hash" text NOT NULL,
  "status" text DEFAULT 'detected' NOT NULL,
  "candidate_type" text NOT NULL,
  "step_ordinals" jsonb NOT NULL,
  "operation_types" jsonb NOT NULL,
  "capability_refs" jsonb NOT NULL,
  "side_effect_risk" text NOT NULL,
  "observation_count" integer NOT NULL,
  "success_rate" double precision NOT NULL,
  "human_correction_rate" double precision,
  "human_correction_evidence_count" integer NOT NULL,
  "human_correction_evidence_coverage" double precision NOT NULL,
  "input_shape_stability" double precision NOT NULL,
  "output_shape_stability" double precision NOT NULL,
  "average_duration_ms" double precision NOT NULL,
  "average_cost" double precision,
  "estimated_latency_savings_ms" double precision NOT NULL,
  "estimated_cost_savings" double precision,
  "observed_run_ids" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workflow_optimizer_suggestions_status_check" CHECK ("status" in ('detected','generated','evaluating','ready_for_shadow','shadowing','ready_to_promote','promoted','rejected','needs_revision')),
  CONSTRAINT "workflow_optimizer_suggestions_candidate_type_check" CHECK ("candidate_type" in ('expression','transform','tool_chain','subworkflow','typescript','python')),
  CONSTRAINT "workflow_optimizer_suggestions_side_effect_risk_check" CHECK ("side_effect_risk" in ('low','medium','high')),
  CONSTRAINT "workflow_optimizer_suggestions_observation_count_check" CHECK ("observation_count" >= 3),
  CONSTRAINT "workflow_optimizer_suggestions_rate_bounds_check" CHECK ("success_rate" between 0 and 1 and ("human_correction_rate" is null or "human_correction_rate" between 0 and 1) and "human_correction_evidence_coverage" between 0 and 1 and "input_shape_stability" between 0 and 1 and "output_shape_stability" between 0 and 1),
  CONSTRAINT "workflow_optimizer_suggestions_nonnegative_metrics_check" CHECK ("human_correction_evidence_count" >= 0 and "human_correction_evidence_count" <= "observation_count" and "average_duration_ms" >= 0 and "estimated_latency_savings_ms" >= 0 and ("average_cost" is null or "average_cost" >= 0) and ("estimated_cost_savings" is null or "estimated_cost_savings" >= 0)),
  CONSTRAINT "workflow_optimizer_suggestions_signature_hash_check" CHECK ("signature_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_optimizer_suggestions_company_id_id_uq" ON "workflow_optimizer_suggestions" ("company_id","id");
--> statement-breakpoint
ALTER TABLE "workflow_optimizer_suggestions" ADD CONSTRAINT "workflow_optimizer_suggestions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workflow_optimizer_suggestions" ADD CONSTRAINT "workflow_optimizer_suggestions_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workflow_optimizer_suggestions" ADD CONSTRAINT "workflow_optimizer_suggestions_workflow_revision_id_workflow_revisions_id_fk" FOREIGN KEY ("workflow_revision_id") REFERENCES "public"."workflow_revisions"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_optimizer_suggestions_company_revision_signature_uq" ON "workflow_optimizer_suggestions" ("company_id","workflow_revision_id","signature_hash");
--> statement-breakpoint
CREATE INDEX "workflow_optimizer_suggestions_company_workflow_status_idx" ON "workflow_optimizer_suggestions" ("company_id","workflow_id","status");
--> statement-breakpoint
CREATE INDEX "workflow_optimizer_suggestions_company_created_idx" ON "workflow_optimizer_suggestions" ("company_id","created_at" DESC);
--> statement-breakpoint
ALTER TABLE "automation_artifacts" ADD CONSTRAINT "automation_artifacts_optimizer_suggestion_fk" FOREIGN KEY ("company_id","created_by_optimizer_suggestion_id") REFERENCES "public"."workflow_optimizer_suggestions"("company_id","id") ON DELETE restrict ON UPDATE no action;
