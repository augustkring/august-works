CREATE TABLE "project_milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"goal_id" uuid,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"target_date" date,
	"planned_start_at" timestamp with time zone,
	"planned_end_at" timestamp with time zone,
	"owner_user_id" text,
	"owner_agent_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_milestones_company_project_id_uq" UNIQUE("company_id","project_id","id"),
	CONSTRAINT "project_milestones_state_check" CHECK ("project_milestones"."status" in ('planned','in_progress','at_risk','completed','cancelled')),
	CONSTRAINT "project_milestones_dates_check" CHECK ("project_milestones"."planned_start_at" is null or "project_milestones"."planned_end_at" is null or "project_milestones"."planned_end_at" >= "project_milestones"."planned_start_at")
);
--> statement-breakpoint
CREATE TABLE "project_roadmap_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"patch_json" jsonb NOT NULL,
	"reason" text NOT NULL,
	"risk" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"reviewed_by_user_id" text,
	"review_rationale" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_roadmap_proposals_state_check" CHECK ("project_roadmap_proposals"."status" in ('pending','accepted','rejected','stale'))
);
--> statement-breakpoint
CREATE TABLE "project_schedule_baselines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"snapshot_json" jsonb NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_company_id_uq" UNIQUE("company_id","id");--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "planned_start_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "planned_end_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "forecast_start_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "forecast_end_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "forecast_confidence" double precision;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "forecast_reason" text;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "milestone_id" uuid;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "estimated_effort_minutes" integer;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "roadmap_policy" jsonb;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_company_id_project_id_projects_company_id_id_fk" FOREIGN KEY ("company_id","project_id") REFERENCES "public"."projects"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_company_id_owner_agent_id_agents_company_id_id_fk" FOREIGN KEY ("company_id","owner_agent_id") REFERENCES "public"."agents"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_roadmap_proposals" ADD CONSTRAINT "project_roadmap_proposals_company_id_project_id_projects_company_id_id_fk" FOREIGN KEY ("company_id","project_id") REFERENCES "public"."projects"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_roadmap_proposals" ADD CONSTRAINT "project_roadmap_proposals_company_id_created_by_agent_id_agents_company_id_id_fk" FOREIGN KEY ("company_id","created_by_agent_id") REFERENCES "public"."agents"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_schedule_baselines" ADD CONSTRAINT "project_schedule_baselines_company_id_project_id_projects_company_id_id_fk" FOREIGN KEY ("company_id","project_id") REFERENCES "public"."projects"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_milestones_target_idx" ON "project_milestones" USING btree ("company_id","project_id","target_date");--> statement-breakpoint
CREATE INDEX "project_roadmap_proposals_project_idx" ON "project_roadmap_proposals" USING btree ("company_id","project_id","status");--> statement-breakpoint
CREATE INDEX "project_schedule_baselines_project_idx" ON "project_schedule_baselines" USING btree ("company_id","project_id","created_at");--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_company_project_milestone_fk" FOREIGN KEY ("company_id","project_id","milestone_id") REFERENCES "public"."project_milestones"("company_id","project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_planning_dates_check" CHECK ("issues"."planned_start_at" is null or "issues"."planned_end_at" is null or "issues"."planned_end_at" >= "issues"."planned_start_at");--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_forecast_dates_check" CHECK ("issues"."forecast_start_at" is null or "issues"."forecast_end_at" is null or "issues"."forecast_end_at" >= "issues"."forecast_start_at");--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_milestone_project_check" CHECK ("issues"."milestone_id" is null or "issues"."project_id" is not null);--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_forecast_confidence_check" CHECK ("issues"."forecast_confidence" is null or "issues"."forecast_confidence" between 0 and 1);--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_estimated_effort_check" CHECK ("issues"."estimated_effort_minutes" is null or "issues"."estimated_effort_minutes" between 1 and 525600);
--> statement-breakpoint
CREATE FUNCTION aw_v5_schedule_baseline_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' OR EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'aw_v5_schedule_baseline_immutable', MESSAGE = 'Schedule baselines are immutable';
  END IF;
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v5_schedule_baseline_immutable BEFORE UPDATE OR DELETE ON project_schedule_baselines FOR EACH ROW EXECUTE FUNCTION aw_v5_schedule_baseline_immutable();
--> statement-breakpoint
CREATE FUNCTION aw_v5_dependency_cycle_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM instance_settings WHERE singleton_key = 'default' AND experimental->>'project_roadmap_v5' = 'true') THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('aw-v5-dependencies:' || NEW.company_id::text, 0));
  IF NEW.company_id IS DISTINCT FROM (SELECT company_id FROM issues WHERE id = NEW.issue_id) OR NEW.company_id IS DISTINCT FROM (SELECT company_id FROM issues WHERE id = NEW.related_issue_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'aw_v5_dependency_company_boundary', MESSAGE = 'Dependencies must remain local';
  END IF;
  IF EXISTS (
    WITH RECURSIVE reach(id) AS (
      SELECT NEW.related_issue_id
      UNION
      SELECT relation.related_issue_id FROM reach JOIN issue_relations relation ON relation.issue_id = reach.id AND relation.company_id = NEW.company_id AND relation.type = 'blocks' AND relation.id <> NEW.id
    ) SELECT 1 FROM reach WHERE id = NEW.issue_id
  ) THEN RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'aw_v5_dependency_cycle', MESSAGE = 'Dependency graph cannot contain cycles'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v5_dependency_cycle_guard BEFORE INSERT OR UPDATE ON issue_relations FOR EACH ROW EXECUTE FUNCTION aw_v5_dependency_cycle_guard();
