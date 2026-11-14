CREATE TABLE "issue_access_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"source" text NOT NULL,
	"granted_by_user_id" text,
	"granted_by_agent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "issue_access_grants_subject_check" CHECK ("issue_access_grants"."subject_type" in ('user','agent') and length(btrim("issue_access_grants"."subject_id")) > 0),
	CONSTRAINT "issue_access_grants_source_check" CHECK ("issue_access_grants"."source" in ('explicit','assignment','project'))
);
--> statement-breakpoint
CREATE TABLE "issue_privacy_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_privacy_sources_kind_check" CHECK ("issue_privacy_sources"."source_kind" in ('issue','project','run'))
);
--> statement-breakpoint
CREATE TABLE "project_access_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_access_members_subject_check" CHECK ("project_access_members"."subject_type" in ('user','agent') and length(btrim("project_access_members"."subject_id")) > 0)
);
--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ADD COLUMN "scope_kind" text DEFAULT 'company' NOT NULL;--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ADD COLUMN "issue_id" uuid;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "visibility" text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "privacy_root_issue_id" uuid;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "privacy_parent_issue_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "visibility" text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "privacy_owner_user_id" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "personal_owner_user_id" text;--> statement-breakpoint
ALTER TABLE "issue_access_grants" ADD CONSTRAINT "issue_access_grants_company_issue_fk" FOREIGN KEY ("company_id","issue_id") REFERENCES "public"."issues"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_privacy_sources" ADD CONSTRAINT "issue_privacy_sources_company_issue_fk" FOREIGN KEY ("company_id","issue_id") REFERENCES "public"."issues"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_access_members" ADD CONSTRAINT "project_access_members_company_project_fk" FOREIGN KEY ("company_id","project_id") REFERENCES "public"."projects"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "issue_access_grants_active_source_uq" ON "issue_access_grants" USING btree ("company_id","issue_id","subject_type","subject_id","source") WHERE "issue_access_grants"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "issue_access_grants_subject_active_idx" ON "issue_access_grants" USING btree ("company_id","subject_type","subject_id","revoked_at","issue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_privacy_sources_source_uq" ON "issue_privacy_sources" USING btree ("company_id","issue_id","source_kind","source_id");--> statement-breakpoint
CREATE INDEX "issue_privacy_sources_source_idx" ON "issue_privacy_sources" USING btree ("company_id","source_kind","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_access_members_subject_uq" ON "project_access_members" USING btree ("company_id","project_id","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "project_access_members_subject_idx" ON "project_access_members" USING btree ("company_id","subject_type","subject_id","project_id");--> statement-breakpoint
CREATE INDEX "heartbeat_runs_company_issue_created_idx" ON "heartbeat_runs" USING btree ("company_id","issue_id","created_at");--> statement-breakpoint
CREATE INDEX "issues_company_privacy_parent_idx" ON "issues" USING btree ("company_id","privacy_parent_issue_id");--> statement-breakpoint
CREATE INDEX "issues_company_privacy_root_idx" ON "issues" USING btree ("company_id","privacy_root_issue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_company_personal_owner_uq" ON "projects" USING btree ("company_id","personal_owner_user_id") WHERE "projects"."personal_owner_user_id" is not null;--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ADD CONSTRAINT "heartbeat_runs_scope_binding_check" CHECK (("heartbeat_runs"."scope_kind" = 'company' and "heartbeat_runs"."issue_id" is null) or "heartbeat_runs"."scope_kind" = 'issue');--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_visibility_check" CHECK ("issues"."visibility" in ('open', 'private'));--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_visibility_check" CHECK ("projects"."visibility" in ('open', 'private'));
--> statement-breakpoint
-- Original runtime binding owner. Retained UUIDs have no source FK: erasure
-- leaves denied provenance rather than converting private history to company scope.
CREATE FUNCTION aw_bind_private_run_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE candidate uuid; context_ref text;
BEGIN
  context_ref := coalesce(NEW.context_snapshot->>'issueId',NEW.context_snapshot->>'taskId');
  candidate := coalesce(NEW.native_issue_id,NEW.issue_id);
  IF candidate IS NULL AND context_ref ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN
    candidate := context_ref::uuid;
  END IF;
  IF TG_OP='UPDATE' AND OLD.scope_kind='issue' THEN
    IF OLD.issue_id IS NOT NULL AND candidate IS NOT NULL AND candidate<>OLD.issue_id THEN
      RAISE EXCEPTION 'run source binding is immutable';
    END IF;
    NEW.scope_kind := 'issue';
    NEW.issue_id := coalesce(OLD.issue_id,candidate);
  ELSIF candidate IS NOT NULL OR NEW.scope_kind='issue' OR NEW.context_snapshot ? 'issueId'
      OR NEW.context_snapshot ? 'taskId' OR NEW.context_snapshot ? 'taskKey' THEN
    NEW.scope_kind := 'issue'; NEW.issue_id := candidate;
  ELSE NEW.scope_kind := 'company'; NEW.issue_id := NULL;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER heartbeat_runs_private_source BEFORE INSERT OR UPDATE OF issue_id,native_issue_id,context_snapshot,scope_kind
 ON heartbeat_runs FOR EACH ROW EXECUTE FUNCTION aw_bind_private_run_source();
--> statement-breakpoint
UPDATE heartbeat_runs SET scope_kind=scope_kind;
--> statement-breakpoint
CREATE FUNCTION aw_retain_task_privacy_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF OLD.privacy_parent_issue_id IS NOT NULL AND NEW.privacy_parent_issue_id IS DISTINCT FROM OLD.privacy_parent_issue_id THEN
      RAISE EXCEPTION 'task source parent is immutable';
    END IF;
    IF OLD.origin_run_id IS NOT NULL AND NEW.origin_run_id IS DISTINCT FROM OLD.origin_run_id THEN
      RAISE EXCEPTION 'task origin run is immutable';
    END IF;
  END IF;
  IF NEW.origin_run_id IS NOT NULL AND NEW.origin_run_id !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN
    -- Existing malformed provenance remains withheld; new writers cannot erase it.
    IF TG_OP='INSERT' OR OLD.origin_run_id IS DISTINCT FROM NEW.origin_run_id THEN
      RAISE EXCEPTION 'task origin run identity is invalid';
    END IF;
  END IF;
  NEW.privacy_parent_issue_id := coalesce(NEW.privacy_parent_issue_id,NEW.parent_id);
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER issues_retain_private_identity BEFORE INSERT OR UPDATE ON issues
 FOR EACH ROW EXECUTE FUNCTION aw_retain_task_privacy_identity();
--> statement-breakpoint
CREATE FUNCTION aw_record_task_privacy_sources() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_run uuid; source_task uuid;
BEGIN
  IF TG_OP='UPDATE' THEN
    INSERT INTO issue_privacy_sources(company_id,issue_id,source_kind,source_id)
      SELECT NEW.company_id,NEW.id,v.kind,v.id FROM (VALUES
        ('issue',OLD.parent_id),('issue',OLD.privacy_parent_issue_id),('project',OLD.project_id)) v(kind,id)
      WHERE v.id IS NOT NULL AND NOT(v.kind='issue' AND v.id=NEW.id) ON CONFLICT DO NOTHING;
  END IF;
  INSERT INTO issue_privacy_sources(company_id,issue_id,source_kind,source_id)
    SELECT NEW.company_id,NEW.id,v.kind,v.id FROM (VALUES
      ('issue',NEW.parent_id),('issue',NEW.privacy_parent_issue_id),('project',NEW.project_id)) v(kind,id)
    WHERE v.id IS NOT NULL AND NOT(v.kind='issue' AND v.id=NEW.id) ON CONFLICT DO NOTHING;
  IF NEW.origin_run_id ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN
    source_run := NEW.origin_run_id::uuid;
    SELECT coalesce(r.issue_id,r.native_issue_id) INTO source_task FROM heartbeat_runs r
      WHERE r.id=source_run AND r.company_id=NEW.company_id;
    -- A run of this very task is not a new copy edge. All other origins,
    -- including missing/foreign runs, remain exact retained source identities.
    IF source_task IS DISTINCT FROM NEW.id THEN
      INSERT INTO issue_privacy_sources(company_id,issue_id,source_kind,source_id)
        VALUES(NEW.company_id,NEW.id,'run',source_run) ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER issues_record_private_sources AFTER INSERT OR UPDATE OF parent_id,privacy_parent_issue_id,project_id,origin_run_id ON issues
 FOR EACH ROW EXECUTE FUNCTION aw_record_task_privacy_sources();
--> statement-breakpoint
UPDATE issues SET privacy_parent_issue_id=coalesce(privacy_parent_issue_id,parent_id);
--> statement-breakpoint
-- Recover creator authority from native creation evidence; a read grant is never management authority.
UPDATE projects p SET privacy_owner_user_id=coalesce(p.personal_owner_user_id,(
 SELECT CASE WHEN a.actor_type='user' THEN a.actor_id ELSE coalesce(a.responsible_user_id,r.responsible_user_id) END
 FROM activity_log a LEFT JOIN heartbeat_runs r ON r.id=a.run_id AND r.company_id=a.company_id
 WHERE a.company_id=p.company_id AND a.entity_type='project' AND a.entity_id=p.id::text AND a.action='project.created'
 ORDER BY a.created_at,a.id LIMIT 1)) WHERE p.privacy_owner_user_id IS NULL;
