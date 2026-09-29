CREATE TABLE "workflows" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "project_id" uuid,
  "folder_id" uuid,
  "name" text NOT NULL,
  "description" text,
  "status" text DEFAULT 'active' NOT NULL,
  "published_revision_id" uuid,
  "draft_revision_id" uuid,
  "created_by_user_id" text,
  "created_by_agent_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone,
  CONSTRAINT "workflows_status_check" CHECK ("workflows"."status" in ('active', 'paused', 'archived')),
  CONSTRAINT "workflows_archive_check" CHECK (("workflows"."status" = 'archived') = ("workflows"."archived_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "workflow_revisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "workflow_id" uuid NOT NULL,
  "revision_number" integer NOT NULL,
  "state" text DEFAULT 'draft' NOT NULL,
  "graph_json" jsonb NOT NULL,
  "input_schema" jsonb,
  "output_schema" jsonb,
  "change_summary" text,
  "created_by_user_id" text,
  "created_by_agent_id" uuid,
  "created_by_run_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workflow_revisions_state_check" CHECK ("workflow_revisions"."state" in ('draft', 'published', 'superseded', 'discarded'))
);
--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workflow_revisions" ADD CONSTRAINT "workflow_revisions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workflow_revisions" ADD CONSTRAINT "workflow_revisions_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workflow_revisions" ADD CONSTRAINT "workflow_revisions_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workflow_revisions" ADD CONSTRAINT "workflow_revisions_created_by_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("created_by_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "workflows_company_status_idx" ON "workflows" USING btree ("company_id","status");
--> statement-breakpoint
CREATE INDEX "workflows_company_updated_idx" ON "workflows" USING btree ("company_id","updated_at");
--> statement-breakpoint
CREATE INDEX "workflows_company_project_idx" ON "workflows" USING btree ("company_id","project_id");
--> statement-breakpoint
CREATE INDEX "workflows_company_folder_idx" ON "workflows" USING btree ("company_id","folder_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_revisions_workflow_revision_uq" ON "workflow_revisions" USING btree ("workflow_id","revision_number");
--> statement-breakpoint
CREATE INDEX "workflow_revisions_company_workflow_state_idx" ON "workflow_revisions" USING btree ("company_id","workflow_id","state");
