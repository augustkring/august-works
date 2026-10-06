ALTER TABLE "learning_hypotheses" DROP CONSTRAINT "learning_hypothesis_target_check";--> statement-breakpoint
ALTER TABLE "learning_retained_assets" DROP CONSTRAINT "learning_retained_asset_type_check";--> statement-breakpoint
ALTER TABLE "learning_hypotheses" ADD CONSTRAINT "learning_hypothesis_target_check" CHECK ("learning_hypotheses"."target_domain" in ('foundation','skill','playbook','project','policy','workflow','role_pack'));--> statement-breakpoint
ALTER TABLE "learning_retained_assets" ADD CONSTRAINT "learning_retained_asset_type_check" CHECK ("learning_retained_assets"."asset_type" in ('document_revision','skill_version','workflow_revision','role_pack_version'));
--> statement-breakpoint
-- Native versions keep their original Memory lineage through later drafts.
CREATE FUNCTION aw_learning_asset_current(p_company uuid,p_type text,p_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT NOT EXISTS (SELECT 1 FROM learning_retained_assets a WHERE a.company_id=p_company AND a.asset_type=p_type AND a.asset_id=p_id AND (a.erased_at IS NOT NULL OR NOT aw_learning_link_current(p_company,a.candidate_link_id)))
$$;
--> statement-breakpoint
CREATE FUNCTION aw_learning_asset_erased(p_company uuid,p_type text,p_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS (SELECT 1 FROM learning_retained_assets a JOIN learning_domain_candidates l ON l.company_id=a.company_id AND l.id=a.candidate_link_id
 JOIN learning_hypotheses h ON h.company_id=l.company_id AND h.id=l.hypothesis_id
 WHERE a.company_id=p_company AND a.asset_type=p_type AND a.asset_id=p_id AND (a.erased_at IS NOT NULL OR l.erased_at IS NOT NULL OR aw_learning_cycle_erased(p_company,h.cycle_id)))
$$;
--> statement-breakpoint
CREATE FUNCTION aw_learning_inherit_native_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_id uuid; native_type text; l learning_retained_assets%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='workflow_revisions' THEN
   native_type:='workflow_revision';
   FOR l IN SELECT a.* FROM learning_retained_assets a JOIN workflows w ON w.company_id=a.company_id AND (a.asset_id=w.draft_revision_id OR a.asset_id=w.published_revision_id)
    WHERE w.company_id=NEW.company_id AND w.id=NEW.workflow_id AND a.asset_type=native_type LOOP
     IF NOT aw_learning_link_current(NEW.company_id,l.candidate_link_id) THEN RAISE EXCEPTION 'Workflow Learning source changed' USING ERRCODE='23514'; END IF;
     INSERT INTO learning_retained_assets(company_id,candidate_link_id,asset_type,asset_id) VALUES(NEW.company_id,l.candidate_link_id,native_type,NEW.id) ON CONFLICT DO NOTHING;
   END LOOP;
 ELSE
   native_type:='role_pack_version';
   SELECT published_version_id INTO parent_id FROM role_packs WHERE company_id=NEW.company_id AND id=NEW.role_pack_id;
   FOR l IN SELECT * FROM learning_retained_assets WHERE company_id=NEW.company_id AND asset_id=parent_id AND asset_type=native_type LOOP
     IF NOT aw_learning_link_current(NEW.company_id,l.candidate_link_id) THEN RAISE EXCEPTION 'Role Pack Learning source changed' USING ERRCODE='23514'; END IF;
     INSERT INTO learning_retained_assets(company_id,candidate_link_id,asset_type,asset_id) VALUES(NEW.company_id,l.candidate_link_id,native_type,NEW.id) ON CONFLICT DO NOTHING;
   END LOOP;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_learning_workflow_inheritance AFTER INSERT ON workflow_revisions FOR EACH ROW EXECUTE FUNCTION aw_learning_inherit_native_version();
--> statement-breakpoint
CREATE TRIGGER aw_learning_role_pack_inheritance AFTER INSERT ON role_pack_versions FOR EACH ROW EXECUTE FUNCTION aw_learning_inherit_native_version();
--> statement-breakpoint
CREATE FUNCTION aw_learning_guard_native_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='workflow_revisions' THEN
   IF aw_learning_asset_erased(NEW.company_id,'workflow_revision',NEW.id) THEN
     NEW.graph_json:='{"version":1,"nodes":[],"edges":[],"variables":[],"settings":{}}'::jsonb; NEW.input_schema:=NULL; NEW.output_schema:=NULL; NEW.change_summary:=NULL;
     NEW.state:=CASE WHEN TG_OP='UPDATE' AND OLD.state IN ('published','superseded') THEN 'superseded' ELSE 'discarded' END;
   ELSIF NEW.state='published' AND NOT aw_learning_asset_current(NEW.company_id,'workflow_revision',NEW.id) THEN RAISE EXCEPTION 'Workflow Learning source changed' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='role_pack_versions' THEN
   IF aw_learning_asset_erased(NEW.company_id,'role_pack_version',NEW.id) THEN NEW.summary:='';
   ELSIF NEW.state='published' AND NOT aw_learning_asset_current(NEW.company_id,'role_pack_version',NEW.id) THEN RAISE EXCEPTION 'Role Pack Learning source changed' USING ERRCODE='23514'; END IF;
 ELSE
   IF TG_TABLE_NAME='workflows' THEN
     IF (NEW.draft_revision_id IS NOT NULL AND NOT aw_learning_asset_current(NEW.company_id,'workflow_revision',NEW.draft_revision_id)) OR (NEW.published_revision_id IS NOT NULL AND NOT aw_learning_asset_current(NEW.company_id,'workflow_revision',NEW.published_revision_id)) THEN RAISE EXCEPTION 'Workflow Learning pointer source changed' USING ERRCODE='23514'; END IF;
   ELSE
     IF NEW.published_version_id IS NOT NULL AND NOT aw_learning_asset_current(NEW.company_id,'role_pack_version',NEW.published_version_id) THEN RAISE EXCEPTION 'Role Pack Learning pointer source changed' USING ERRCODE='23514'; END IF;
   END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aaa_learning_workflow_version BEFORE INSERT OR UPDATE ON workflow_revisions FOR EACH ROW EXECUTE FUNCTION aw_learning_guard_native_version();
--> statement-breakpoint
CREATE TRIGGER aaa_learning_role_pack_version BEFORE INSERT OR UPDATE ON role_pack_versions FOR EACH ROW EXECUTE FUNCTION aw_learning_guard_native_version();
--> statement-breakpoint
CREATE TRIGGER aw_learning_workflow_pointer BEFORE INSERT OR UPDATE ON workflows FOR EACH ROW EXECUTE FUNCTION aw_learning_guard_native_version();
--> statement-breakpoint
CREATE TRIGGER aw_learning_role_pack_pointer BEFORE INSERT OR UPDATE ON role_packs FOR EACH ROW EXECUTE FUNCTION aw_learning_guard_native_version();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "aw_guard_workflow_revision_update"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN

  IF aw_learning_asset_erased(OLD.company_id,'workflow_revision',OLD.id)
     AND ROW(NEW.id,NEW.company_id,NEW.workflow_id,NEW.revision_number,NEW.created_by_user_id,NEW.created_by_agent_id,NEW.created_by_run_id,NEW.created_at)
       IS NOT DISTINCT FROM ROW(OLD.id,OLD.company_id,OLD.workflow_id,OLD.revision_number,OLD.created_by_user_id,OLD.created_by_agent_id,OLD.created_by_run_id,OLD.created_at)
     AND NEW.graph_json='{"version":1,"nodes":[],"edges":[],"variables":[],"settings":{}}'::jsonb
     AND NEW.input_schema IS NULL AND NEW.output_schema IS NULL AND NEW.change_summary IS NULL
     AND NEW.state=(CASE WHEN OLD.state IN ('published','superseded') THEN 'superseded' ELSE 'discarded' END) THEN RETURN NEW; END IF;
  IF ROW(
    NEW."company_id",
    NEW."workflow_id",
    NEW."revision_number",
    NEW."graph_json",
    NEW."input_schema",
    NEW."output_schema",
    NEW."change_summary",
    NEW."created_by_user_id",
    NEW."created_by_agent_id",
    NEW."created_by_run_id",
    NEW."created_at"
  ) IS DISTINCT FROM ROW(
    OLD."company_id",
    OLD."workflow_id",
    OLD."revision_number",
    OLD."graph_json",
    OLD."input_schema",
    OLD."output_schema",
    OLD."change_summary",
    OLD."created_by_user_id",
    OLD."created_by_agent_id",
    OLD."created_by_run_id",
    OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'workflow revision snapshot content is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."state" IS DISTINCT FROM OLD."state"
     AND NOT (
       (OLD."state" = 'draft' AND NEW."state" IN ('published', 'discarded'))
       OR
       (OLD."state" = 'published' AND NEW."state" = 'superseded')
     ) THEN
    RAISE EXCEPTION 'invalid workflow revision state transition: % -> %', OLD."state", NEW."state"
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v5_guard_role_pack_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND aw_learning_asset_erased(OLD.company_id,'role_pack_version',OLD.id) AND NEW.summary=''
 AND (to_jsonb(NEW)-'summary')=(to_jsonb(OLD)-'summary') THEN RETURN NEW; END IF;
 IF OLD.state='published' AND EXISTS(SELECT 1 FROM role_packs WHERE id=OLD.role_pack_id) THEN RAISE EXCEPTION 'Published Role Pack versions are immutable' USING ERRCODE='23514',CONSTRAINT='aw_v5_published_role_pack_immutable'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v5_guard_role_pack_items() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id uuid; parent_state text;
BEGIN
 target_id:=CASE WHEN TG_OP='DELETE' THEN OLD.version_id ELSE NEW.version_id END;
 IF TG_OP='DELETE' AND aw_learning_asset_erased(OLD.company_id,'role_pack_version',target_id) THEN RETURN OLD; END IF;
 IF TG_OP<>'DELETE' AND NOT aw_learning_asset_current(NEW.company_id,'role_pack_version',target_id) THEN RAISE EXCEPTION 'Role Pack Learning source changed' USING ERRCODE='23514'; END IF;
 SELECT state INTO parent_state FROM role_pack_versions WHERE id=target_id FOR SHARE;
 IF parent_state='published' THEN RAISE EXCEPTION 'Published Role Pack items are immutable' USING ERRCODE='23514',CONSTRAINT='aw_v5_published_role_pack_immutable'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF TG_OP='UPDATE' AND OLD.version_id<>NEW.version_id THEN RAISE EXCEPTION 'Role Pack item version association is immutable' USING ERRCODE='23514',CONSTRAINT='aw_v5_published_role_pack_immutable'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
-- Root identities are appended at the database boundary so executor rewrites cannot drop them.
CREATE FUNCTION aw_learning_workflow_execution_lineage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE revision_id uuid; refs jsonb;
BEGIN
 IF TG_TABLE_NAME='workflow_runs' THEN revision_id:=NEW.workflow_revision_id;
 ELSE SELECT workflow_revision_id INTO revision_id FROM workflow_runs WHERE company_id=NEW.company_id AND id=NEW.workflow_run_id; END IF;
 IF TG_OP='UPDATE' AND aw_learning_asset_erased(NEW.company_id,'workflow_revision',revision_id) AND OLD.status NOT IN ('succeeded','failed','cancelled','skipped','retried') THEN NEW.status:='cancelled'; NEW.finished_at:=now(); IF TG_TABLE_NAME='workflow_runs' THEN NEW.execution_owner_id:=NULL; NEW.lease_expires_at:=NULL; END IF; END IF;
 IF NOT aw_learning_asset_current(NEW.company_id,'workflow_revision',revision_id) AND (TG_OP='INSERT' OR (NEW.status NOT IN ('cancelled','failed','cancelling') AND NOT (TG_OP='UPDATE' AND aw_learning_asset_erased(NEW.company_id,'workflow_revision',revision_id) AND OLD.status IN ('succeeded','failed','cancelled','skipped','retried') AND NEW.status=OLD.status))) THEN RAISE EXCEPTION 'Workflow Learning source changed' USING ERRCODE='23514'; END IF;
 SELECT coalesce(jsonb_agg(DISTINCT e.memory_record_id::text),'[]'::jsonb) INTO refs FROM learning_retained_assets a
 JOIN learning_domain_candidates l ON l.company_id=a.company_id AND l.id=a.candidate_link_id
 JOIN learning_hypotheses h ON h.company_id=l.company_id AND h.id=l.hypothesis_id
 JOIN learning_evidence e ON e.company_id=h.company_id AND e.cycle_id=h.cycle_id
 WHERE a.company_id=NEW.company_id AND a.asset_type='workflow_revision' AND a.asset_id=revision_id;
 SELECT coalesce(jsonb_agg(DISTINCT value),'[]'::jsonb) INTO NEW.memory_record_ids FROM jsonb_array_elements(NEW.memory_record_ids||refs);
 IF aw_learning_asset_erased(NEW.company_id,'workflow_revision',revision_id) THEN
   IF TG_TABLE_NAME='workflow_runs' THEN NEW.trigger_payload:='{}'::jsonb; NEW.failure_message:=NULL;
   ELSE NEW.input_json:=NULL; NEW.output_json:=NULL; NEW.task_result_json:=NULL; NEW.error_message:=NULL; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aaa_learning_workflow_run_lineage BEFORE INSERT OR UPDATE ON workflow_runs FOR EACH ROW EXECUTE FUNCTION aw_learning_workflow_execution_lineage();
--> statement-breakpoint
CREATE TRIGGER aaa_learning_workflow_step_lineage BEFORE INSERT OR UPDATE ON workflow_step_runs FOR EACH ROW EXECUTE FUNCTION aw_learning_workflow_execution_lineage();
