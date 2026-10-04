CREATE TABLE "company_skill_dependencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"skill_version_id" uuid NOT NULL,
	"dependency_type" text NOT NULL,
	"dependency_ref" text NOT NULL,
	"dependency_version" text NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'current' NOT NULL,
	"invalidated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_skill_dependencies_version_ref_uq" UNIQUE("skill_version_id","dependency_type","dependency_ref"),
	CONSTRAINT "company_skill_dependencies_state_check" CHECK ("company_skill_dependencies"."status" in ('current','changed','missing'))
);
--> statement-breakpoint

CREATE TABLE "company_skill_eval_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"suite_id" uuid NOT NULL,
	"name" text NOT NULL,
	"input" text NOT NULL,
	"should_trigger" boolean NOT NULL,
	"risk" text NOT NULL,
	"rubric" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_skill_eval_cases_company_suite_id_uq" UNIQUE("company_id","suite_id","id")
);
--> statement-breakpoint

CREATE TABLE "company_skill_eval_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"suite_id" uuid NOT NULL,
	"candidate_version_id" uuid NOT NULL,
	"champion_version_id" uuid,
	"trials" integer NOT NULL,
	"case_set_hash" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"agent_snapshot" jsonb,
	"aggregate" jsonb,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "company_skill_eval_runs_company_suite_id_uq" UNIQUE("company_id","suite_id","id"),
	CONSTRAINT "company_skill_eval_runs_state_check" CHECK ("company_skill_eval_runs"."status" in ('running','passed','failed','inconclusive','cancelled'))
);
--> statement-breakpoint

CREATE TABLE "company_skill_eval_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"suite_id" uuid NOT NULL,
	"eval_run_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"trial" integer NOT NULL,
	"arm" text NOT NULL,
	"test_run_id" uuid NOT NULL,
	"scores" jsonb NOT NULL,
	"judge_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_skill_eval_scores_observation_uq" UNIQUE("eval_run_id","case_id","trial","arm"),
	CONSTRAINT "company_skill_eval_scores_trace_uq" UNIQUE("eval_run_id","test_run_id"),
	CONSTRAINT "company_skill_eval_scores_arm_check" CHECK ("company_skill_eval_scores"."arm" in ('champion','candidate'))
);
--> statement-breakpoint

CREATE TABLE "company_skill_eval_suites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"name" text NOT NULL,
	"required_for_promotion" boolean DEFAULT true NOT NULL,
	"case_set_hash" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_skill_eval_suites_company_id_uq" UNIQUE("company_id","id")
);
--> statement-breakpoint

CREATE TABLE "company_skill_usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"skill_version_id" uuid NOT NULL,
	"selection_reason" text NOT NULL,
	"stage" text NOT NULL,
	"outcome" text DEFAULT 'unknown' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_skill_usage_events_run_stage_uq" UNIQUE("run_id","skill_version_id","stage"),
	CONSTRAINT "company_skill_usage_events_stage_check" CHECK ("company_skill_usage_events"."stage" in ('offered','selected','loaded','used','completed','corrected','failure'))
);
--> statement-breakpoint

ALTER TABLE "company_skill_versions" ADD COLUMN "state" text DEFAULT 'candidate' NOT NULL;--> statement-breakpoint

ALTER TABLE "company_skill_versions" ADD COLUMN "source_playbook_revision_id" uuid;--> statement-breakpoint

ALTER TABLE "company_skill_versions" ADD COLUMN "validation_summary" jsonb;--> statement-breakpoint

ALTER TABLE "company_skill_versions" ADD COLUMN "activated_at" timestamp with time zone;--> statement-breakpoint

ALTER TABLE "company_skill_versions" ADD COLUMN "rejected_at" timestamp with time zone;--> statement-breakpoint

ALTER TABLE "company_skills" ADD COLUMN "lifecycle_state" text DEFAULT 'draft' NOT NULL;--> statement-breakpoint

ALTER TABLE "company_skills" ADD COLUMN "owner_agent_id" uuid;--> statement-breakpoint

ALTER TABLE "company_skills" ADD COLUMN "active_version_id" uuid;--> statement-breakpoint

ALTER TABLE "company_skills" ADD COLUMN "head_version_id" uuid;--> statement-breakpoint

ALTER TABLE "company_skills" ADD COLUMN "last_validated_at" timestamp with time zone;--> statement-breakpoint

ALTER TABLE "company_skills" ADD COLUMN "next_review_at" timestamp with time zone;--> statement-breakpoint

ALTER TABLE "company_skills" ADD COLUMN "degraded_reason" text;--> statement-breakpoint

ALTER TABLE "company_skills" ADD COLUMN "review_policy" jsonb DEFAULT '{"reviewIntervalDays":90,"stewardUserId":null}'::jsonb NOT NULL;--> statement-breakpoint

ALTER TABLE "company_skills" ADD COLUMN "promotion_policy" jsonb DEFAULT '{"allowAutonomousPromotion":false,"minimumPairedTrials":2,"minimumOutcomeScore":0.9,"maximumCostRegressionRatio":1.25,"requireHumanReview":true}'::jsonb NOT NULL;--> statement-breakpoint

ALTER TABLE "company_skill_versions" ADD CONSTRAINT "company_skill_versions_company_skill_id_uq" UNIQUE("company_id","company_skill_id","id");--> statement-breakpoint

ALTER TABLE "company_skills" ADD CONSTRAINT "company_skills_company_id_uq" UNIQUE("company_id","id");--> statement-breakpoint

ALTER TABLE "company_skill_dependencies" ADD CONSTRAINT "company_skill_dependencies_company_id_skill_id_skill_version_id_company_skill_versions_company_id_company_skill_id_id_fk" FOREIGN KEY ("company_id","skill_id","skill_version_id") REFERENCES "public"."company_skill_versions"("company_id","company_skill_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "company_skill_eval_cases" ADD CONSTRAINT "company_skill_eval_cases_company_id_suite_id_company_skill_eval_suites_company_id_id_fk" FOREIGN KEY ("company_id","suite_id") REFERENCES "public"."company_skill_eval_suites"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "company_skill_eval_runs" ADD CONSTRAINT "company_skill_eval_runs_company_id_suite_id_company_skill_eval_suites_company_id_id_fk" FOREIGN KEY ("company_id","suite_id") REFERENCES "public"."company_skill_eval_suites"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "company_skill_eval_runs" ADD CONSTRAINT "company_skill_eval_runs_company_id_skill_id_candidate_version_id_company_skill_versions_company_id_company_skill_id_id_fk" FOREIGN KEY ("company_id","skill_id","candidate_version_id") REFERENCES "public"."company_skill_versions"("company_id","company_skill_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "company_skill_eval_runs" ADD CONSTRAINT "company_skill_eval_runs_company_id_skill_id_champion_version_id_company_skill_versions_company_id_company_skill_id_id_fk" FOREIGN KEY ("company_id","skill_id","champion_version_id") REFERENCES "public"."company_skill_versions"("company_id","company_skill_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "company_skill_eval_scores" ADD CONSTRAINT "company_skill_eval_scores_test_run_id_company_skill_test_runs_id_fk" FOREIGN KEY ("test_run_id") REFERENCES "public"."company_skill_test_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "company_skill_eval_scores" ADD CONSTRAINT "company_skill_eval_scores_company_id_suite_id_case_id_company_skill_eval_cases_company_id_suite_id_id_fk" FOREIGN KEY ("company_id","suite_id","case_id") REFERENCES "public"."company_skill_eval_cases"("company_id","suite_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "company_skill_eval_scores" ADD CONSTRAINT "company_skill_eval_scores_company_id_suite_id_eval_run_id_company_skill_eval_runs_company_id_suite_id_id_fk" FOREIGN KEY ("company_id","suite_id","eval_run_id") REFERENCES "public"."company_skill_eval_runs"("company_id","suite_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "company_skill_eval_suites" ADD CONSTRAINT "company_skill_eval_suites_company_id_skill_id_company_skills_company_id_id_fk" FOREIGN KEY ("company_id","skill_id") REFERENCES "public"."company_skills"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "company_skill_usage_events" ADD CONSTRAINT "company_skill_usage_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "company_skill_usage_events" ADD CONSTRAINT "company_skill_usage_events_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "company_skill_usage_events" ADD CONSTRAINT "company_skill_usage_events_company_id_skill_id_skill_version_id_company_skill_versions_company_id_company_skill_id_id_fk" FOREIGN KEY ("company_id","skill_id","skill_version_id") REFERENCES "public"."company_skill_versions"("company_id","company_skill_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "company_skill_usage_events" ADD CONSTRAINT "company_skill_usage_events_company_id_agent_id_agents_company_id_id_fk" FOREIGN KEY ("company_id","agent_id") REFERENCES "public"."agents"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "company_skill_dependencies_lookup_idx" ON "company_skill_dependencies" USING btree ("company_id","dependency_type","dependency_ref");--> statement-breakpoint

CREATE INDEX "company_skill_eval_cases_suite_idx" ON "company_skill_eval_cases" USING btree ("company_id","suite_id");--> statement-breakpoint

CREATE INDEX "company_skill_eval_runs_skill_idx" ON "company_skill_eval_runs" USING btree ("company_id","skill_id");--> statement-breakpoint

CREATE INDEX "company_skill_eval_suites_skill_idx" ON "company_skill_eval_suites" USING btree ("company_id","skill_id");--> statement-breakpoint

CREATE INDEX "company_skill_usage_events_skill_idx" ON "company_skill_usage_events" USING btree ("company_id","skill_id","created_at");--> statement-breakpoint

ALTER TABLE "company_skills" ADD CONSTRAINT "company_skills_company_id_owner_agent_id_agents_company_id_id_fk" FOREIGN KEY ("company_id","owner_agent_id") REFERENCES "public"."agents"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "company_skills" ADD CONSTRAINT "company_skills_company_id_id_active_version_id_company_skill_versions_company_id_company_skill_id_id_fk" FOREIGN KEY ("company_id","id","active_version_id") REFERENCES "public"."company_skill_versions"("company_id","company_skill_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "company_skills" ADD CONSTRAINT "company_skills_company_id_id_head_version_id_company_skill_versions_company_id_company_skill_id_id_fk" FOREIGN KEY ("company_id","id","head_version_id") REFERENCES "public"."company_skill_versions"("company_id","company_skill_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

CREATE UNIQUE INDEX "company_skill_versions_one_active_idx" ON "company_skill_versions" USING btree ("company_skill_id") WHERE "company_skill_versions"."state" = 'active';--> statement-breakpoint

ALTER TABLE "company_skill_versions" ADD CONSTRAINT "company_skill_versions_state_check" CHECK ("company_skill_versions"."state" in ('candidate','testing','validated','active','rejected','superseded'));--> statement-breakpoint

ALTER TABLE "company_skills" ADD CONSTRAINT "company_skills_lifecycle_check" CHECK ("company_skills"."lifecycle_state" in ('draft','proposed','testing','active','needs_revalidation','degraded','deprecated','revoked'));
--> statement-breakpoint
-- Grandfather only owned immutable legacy versions. A source without an
-- immutable compatible snapshot needs explicit validation before V5 selection.
DO $$
DECLARE last_id uuid; batch_ids uuid[];
BEGIN
  LOOP
    SELECT array_agg(id ORDER BY id) INTO batch_ids FROM (
      SELECT id FROM company_skills WHERE last_id IS NULL OR id > last_id ORDER BY id LIMIT 1000
    ) batch;
    EXIT WHEN batch_ids IS NULL;
    UPDATE company_skills s SET
      active_version_id = CASE WHEN s.compatibility = 'compatible' THEN (SELECT v.id FROM company_skill_versions v WHERE v.id = s.current_version_id AND v.company_id = s.company_id AND v.company_skill_id = s.id) ELSE NULL END,
      head_version_id = (SELECT v.id FROM company_skill_versions v WHERE v.id = s.current_version_id AND v.company_id = s.company_id AND v.company_skill_id = s.id),
      lifecycle_state = CASE WHEN s.compatibility = 'compatible' AND EXISTS (SELECT 1 FROM company_skill_versions v WHERE v.id = s.current_version_id AND v.company_id = s.company_id AND v.company_skill_id = s.id) THEN 'active' ELSE 'needs_revalidation' END,
      degraded_reason = CASE WHEN s.compatibility = 'compatible' AND EXISTS (SELECT 1 FROM company_skill_versions v WHERE v.id = s.current_version_id AND v.company_id = s.company_id AND v.company_skill_id = s.id) THEN NULL ELSE 'legacy_version_unavailable_or_incompatible' END
      WHERE s.id = ANY(batch_ids);
    UPDATE company_skill_versions v SET state = CASE WHEN s.active_version_id = v.id THEN 'active' ELSE 'superseded' END,
      activated_at = CASE WHEN s.active_version_id = v.id THEN v.created_at ELSE NULL END
      FROM company_skills s WHERE s.id = ANY(batch_ids) AND v.company_skill_id = s.id AND v.company_id = s.company_id;
    last_id := batch_ids[array_length(batch_ids, 1)];
  END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION aw_v5_skill_version_head() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE company_skills SET head_version_id = NEW.id WHERE id = NEW.company_skill_id AND company_id = NEW.company_id;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v5_skill_version_on_insert AFTER INSERT ON company_skill_versions FOR EACH ROW EXECUTE FUNCTION aw_v5_skill_version_head();
--> statement-breakpoint
CREATE FUNCTION aw_v5_guard_skill_version_content() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.company_id, NEW.company_skill_id, NEW.revision_number, NEW.file_inventory, NEW.author_user_id, NEW.source_playbook_revision_id)
    IS DISTINCT FROM (OLD.company_id, OLD.company_skill_id, OLD.revision_number, OLD.file_inventory, OLD.author_user_id, OLD.source_playbook_revision_id) THEN
    RAISE EXCEPTION 'Skill version content and provenance are immutable' USING ERRCODE = '23514', CONSTRAINT = 'aw_v5_skill_version_immutable';
  END IF;
  IF NEW.author_agent_id IS DISTINCT FROM OLD.author_agent_id AND NOT (NEW.author_agent_id IS NULL AND NOT EXISTS (SELECT 1 FROM agents WHERE id = OLD.author_agent_id)) THEN
    RAISE EXCEPTION 'Skill version author cannot be changed' USING ERRCODE = '23514', CONSTRAINT = 'aw_v5_skill_version_immutable';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v5_skill_version_immutable BEFORE UPDATE ON company_skill_versions FOR EACH ROW EXECUTE FUNCTION aw_v5_guard_skill_version_content();
