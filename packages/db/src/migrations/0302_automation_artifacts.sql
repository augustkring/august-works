CREATE TABLE "automation_artifacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "kind" text NOT NULL,
  "language" text,
  "input_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "output_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "risk_class" text NOT NULL,
  "side_effect_class" text NOT NULL,
  "status" text DEFAULT 'candidate' NOT NULL,
  "created_by_agent_id" uuid,
  "created_by_user_id" text,
  "created_by_optimizer_suggestion_id" uuid,
  "origin_workflow_id" uuid,
  "origin_node_id" text,
  "latest_version_id" uuid,
  "success_count" integer DEFAULT 0 NOT NULL,
  "failure_count" integer DEFAULT 0 NOT NULL,
  "last_used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone,
  CONSTRAINT "automation_artifacts_kind_check" CHECK ("kind" in ('expression','transform','typescript','python','tool_chain','subworkflow')),
  CONSTRAINT "automation_artifacts_language_check" CHECK (("kind" = 'typescript' and "language" = 'typescript') or ("kind" = 'python' and "language" = 'python') or ("kind" not in ('typescript','python') and "language" is null)),
  CONSTRAINT "automation_artifacts_status_check" CHECK ("status" in ('candidate','testing','shadow','active','deprecated','revoked','failed')),
  CONSTRAINT "automation_artifacts_risk_class_check" CHECK ("risk_class" in ('C0','C1','C2','C3','C4')),
  CONSTRAINT "automation_artifacts_side_effect_class_check" CHECK ("side_effect_class" in ('pure','read','write','destructive','external_communication','financial','privileged')),
  CONSTRAINT "automation_artifacts_creator_check" CHECK (num_nonnulls("created_by_agent_id", "created_by_user_id", "created_by_optimizer_suggestion_id") <= 1),
  CONSTRAINT "automation_artifacts_origin_check" CHECK ("origin_node_id" is null or "origin_workflow_id" is not null),
  CONSTRAINT "automation_artifacts_counters_check" CHECK ("success_count" >= 0 and "failure_count" >= 0),
  CONSTRAINT "automation_artifacts_archive_check" CHECK ("archived_at" is null or "status" in ('deprecated','revoked'))
);
--> statement-breakpoint
CREATE TABLE "automation_artifact_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "artifact_id" uuid NOT NULL,
  "version_number" integer NOT NULL,
  "source_code" text NOT NULL,
  "input_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "output_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "dependency_manifest" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "test_spec" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "validation_report" jsonb,
  "security_report" jsonb,
  "content_hash" text NOT NULL,
  "created_by_agent_id" uuid,
  "created_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "automation_artifact_versions_version_check" CHECK ("version_number" >= 1),
  CONSTRAINT "automation_artifact_versions_content_hash_check" CHECK ("content_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "automation_artifact_versions_source_size_check" CHECK (char_length("source_code") between 1 and 1000000),
  CONSTRAINT "automation_artifact_versions_creator_check" CHECK (num_nonnulls("created_by_agent_id", "created_by_user_id") <= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "workflows_company_id_id_uq" ON "workflows" ("company_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "automation_artifacts_company_id_id_uq" ON "automation_artifacts" ("company_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "automation_artifact_versions_company_id_id_uq" ON "automation_artifact_versions" ("company_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "automation_artifact_versions_artifact_version_uq" ON "automation_artifact_versions" ("artifact_id","version_number");
--> statement-breakpoint
CREATE UNIQUE INDEX "automation_artifact_versions_artifact_content_hash_uq" ON "automation_artifact_versions" ("artifact_id","content_hash");
--> statement-breakpoint
ALTER TABLE "automation_artifacts" ADD CONSTRAINT "automation_artifacts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "automation_artifacts" ADD CONSTRAINT "automation_artifacts_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "automation_artifacts" ADD CONSTRAINT "automation_artifacts_company_origin_workflow_fk" FOREIGN KEY ("company_id","origin_workflow_id") REFERENCES "public"."workflows"("company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "automation_artifact_versions" ADD CONSTRAINT "automation_artifact_versions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "automation_artifact_versions" ADD CONSTRAINT "automation_artifact_versions_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "automation_artifact_versions" ADD CONSTRAINT "automation_artifact_versions_company_artifact_fk" FOREIGN KEY ("company_id","artifact_id") REFERENCES "public"."automation_artifacts"("company_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "automation_artifacts" ADD CONSTRAINT "automation_artifacts_company_latest_version_fk" FOREIGN KEY ("company_id","latest_version_id") REFERENCES "public"."automation_artifact_versions"("company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "automation_artifacts_company_status_updated_idx" ON "automation_artifacts" ("company_id","status","updated_at");
--> statement-breakpoint
CREATE INDEX "automation_artifacts_company_kind_idx" ON "automation_artifacts" ("company_id","kind");
--> statement-breakpoint
CREATE INDEX "automation_artifacts_company_origin_workflow_idx" ON "automation_artifacts" ("company_id","origin_workflow_id");
--> statement-breakpoint
CREATE INDEX "automation_artifact_versions_company_artifact_created_idx" ON "automation_artifact_versions" ("company_id","artifact_id","created_at");
