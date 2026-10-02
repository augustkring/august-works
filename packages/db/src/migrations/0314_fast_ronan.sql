CREATE TABLE "workflow_optimizer_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"suggestion_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"workflow_revision_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"artifact_id" uuid NOT NULL,
	"artifact_version_id" uuid NOT NULL,
	"content_hash" text NOT NULL,
	"status" text DEFAULT 'testing' NOT NULL,
	"compiler_result" jsonb,
	"replay_evaluation" jsonb,
	"shadow_evaluation" jsonb,
	"invariants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_run_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"memory_record_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"known_input_shapes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"approval_id" uuid,
	"canary_traffic_percent" integer DEFAULT 20 NOT NULL,
	"created_by" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_optimizer_evaluations_status_check" CHECK ("workflow_optimizer_evaluations"."status" in ('testing', 'failed', 'shadow', 'canary', 'active', 'degraded', 'retired')),
	CONSTRAINT "workflow_optimizer_evaluations_traffic_check" CHECK ("workflow_optimizer_evaluations"."canary_traffic_percent" between 1 and 50)
);
--> statement-breakpoint
CREATE TABLE "workflow_optimizer_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"evaluation_id" uuid NOT NULL,
	"workflow_run_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"mode" text NOT NULL,
	"candidate_used" boolean NOT NULL,
	"passed" boolean NOT NULL,
	"fallback" boolean NOT NULL,
	"input_shape_hash" text NOT NULL,
	"new_input_shape" boolean NOT NULL,
	"invariant_failure" boolean NOT NULL,
	"error_code" text,
	"duration_ms" integer NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_optimizer_observations_mode_check" CHECK ("workflow_optimizer_observations"."mode" in ('shadow', 'canary', 'active'))
);
--> statement-breakpoint
ALTER TABLE "workflow_optimizer_evaluations" ADD CONSTRAINT "workflow_optimizer_evaluations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_optimizer_evaluations" ADD CONSTRAINT "workflow_optimizer_evaluations_suggestion_id_workflow_optimizer_suggestions_id_fk" FOREIGN KEY ("suggestion_id") REFERENCES "public"."workflow_optimizer_suggestions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_optimizer_evaluations" ADD CONSTRAINT "workflow_optimizer_evaluations_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_optimizer_evaluations" ADD CONSTRAINT "workflow_optimizer_evaluations_workflow_revision_id_workflow_revisions_id_fk" FOREIGN KEY ("workflow_revision_id") REFERENCES "public"."workflow_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_optimizer_evaluations" ADD CONSTRAINT "workflow_optimizer_evaluations_artifact_id_automation_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."automation_artifacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_optimizer_evaluations" ADD CONSTRAINT "workflow_optimizer_evaluations_artifact_version_id_automation_artifact_versions_id_fk" FOREIGN KEY ("artifact_version_id") REFERENCES "public"."automation_artifact_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_optimizer_observations" ADD CONSTRAINT "workflow_optimizer_observations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_optimizer_observations" ADD CONSTRAINT "workflow_optimizer_observations_evaluation_id_workflow_optimizer_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."workflow_optimizer_evaluations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_optimizer_observations" ADD CONSTRAINT "workflow_optimizer_observations_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_optimizer_evaluations_company_workflow_idx" ON "workflow_optimizer_evaluations" USING btree ("company_id","workflow_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_optimizer_evaluations_live_node_uq" ON "workflow_optimizer_evaluations" USING btree ("company_id","workflow_revision_id","node_id") WHERE "workflow_optimizer_evaluations"."status" in ('shadow', 'canary', 'active');--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_optimizer_evaluations_version_uq" ON "workflow_optimizer_evaluations" USING btree ("company_id","artifact_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_optimizer_observations_evaluation_run_node_uq" ON "workflow_optimizer_observations" USING btree ("company_id","evaluation_id","workflow_run_id","node_id");--> statement-breakpoint
CREATE INDEX "workflow_optimizer_observations_company_evaluation_idx" ON "workflow_optimizer_observations" USING btree ("company_id","evaluation_id");