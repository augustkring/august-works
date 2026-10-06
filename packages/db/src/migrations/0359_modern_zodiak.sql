ALTER TABLE "automation_artifact_versions" DROP CONSTRAINT "automation_artifact_versions_source_size_check";--> statement-breakpoint
ALTER TABLE "learning_hypotheses" DROP CONSTRAINT "learning_hypothesis_target_check";--> statement-breakpoint
ALTER TABLE "learning_retained_assets" DROP CONSTRAINT "learning_retained_asset_type_check";--> statement-breakpoint
ALTER TABLE "automation_artifact_versions" ADD CONSTRAINT "automation_artifact_versions_source_size_check" CHECK (char_length("automation_artifact_versions"."source_code") between 0 and 1000000);--> statement-breakpoint
ALTER TABLE "learning_hypotheses" ADD CONSTRAINT "learning_hypothesis_target_check" CHECK ("learning_hypotheses"."target_domain" in ('foundation','skill','playbook','project','policy','workflow','role_pack','automation_artifact'));--> statement-breakpoint
ALTER TABLE "learning_retained_assets" ADD CONSTRAINT "learning_retained_asset_type_check" CHECK ("learning_retained_assets"."asset_type" in ('document_revision','skill_version','workflow_revision','role_pack_version','automation_artifact_version'));
--> statement-breakpoint
-- Only surviving deletion provenance permits content erasure of immutable artifacts.
CREATE FUNCTION aw_optimizer_artifact_erased(p_company uuid,p_artifact uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS (SELECT 1 FROM workflow_optimizer_evaluations e CROSS JOIN LATERAL jsonb_array_elements_text(e.memory_record_ids) r(id)
 WHERE e.company_id=p_company AND e.artifact_id=p_artifact AND (EXISTS (SELECT 1 FROM memory_deletion_markers m WHERE m.company_id=p_company AND m.record_id::text=r.id)
 OR NOT EXISTS (SELECT 1 FROM memory_records m WHERE m.company_id=p_company AND m.id::text=r.id AND m.deleted_at IS NULL)))
$$;
--> statement-breakpoint
CREATE FUNCTION aw_learning_artifact_payload_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF aw_optimizer_artifact_erased(NEW.company_id,NEW.artifact_id) OR aw_learning_asset_erased(NEW.company_id,'automation_artifact_version',NEW.id) THEN
   NEW.source_code:=''; NEW.input_schema:='{}'::jsonb; NEW.output_schema:='{}'::jsonb; NEW.dependency_manifest:='{}'::jsonb; NEW.test_spec:='{}'::jsonb; NEW.validation_report:=NULL; NEW.security_report:=NULL;
 ELSIF NEW.source_code='' THEN RAISE EXCEPTION 'Empty artifact source requires deletion provenance' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aaa_learning_artifact_payload BEFORE INSERT OR UPDATE ON automation_artifact_versions FOR EACH ROW EXECUTE FUNCTION aw_learning_artifact_payload_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "aw_guard_automation_artifact_version_update"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN

 IF (aw_optimizer_artifact_erased(OLD.company_id,OLD.artifact_id) OR aw_learning_asset_erased(OLD.company_id,'automation_artifact_version',OLD.id))
 AND NEW.source_code='' AND NEW.input_schema='{}'::jsonb AND NEW.output_schema='{}'::jsonb AND NEW.dependency_manifest='{}'::jsonb AND NEW.test_spec='{}'::jsonb
 AND NEW.validation_report IS NULL AND NEW.security_report IS NULL
 AND (to_jsonb(NEW)-ARRAY['source_code','input_schema','output_schema','dependency_manifest','test_spec','validation_report','security_report'])=(to_jsonb(OLD)-ARRAY['source_code','input_schema','output_schema','dependency_manifest','test_spec','validation_report','security_report']) THEN RETURN NEW; END IF;
  IF ROW(
    NEW."company_id",
    NEW."artifact_id",
    NEW."version_number",
    NEW."source_code",
    NEW."input_schema",
    NEW."output_schema",
    NEW."dependency_manifest",
    NEW."test_spec",
    NEW."content_hash",
    NEW."created_by_agent_id",
    NEW."created_by_user_id",
    NEW."created_at"
  ) IS DISTINCT FROM ROW(
    OLD."company_id",
    OLD."artifact_id",
    OLD."version_number",
    OLD."source_code",
    OLD."input_schema",
    OLD."output_schema",
    OLD."dependency_manifest",
    OLD."test_spec",
    OLD."content_hash",
    OLD."created_by_agent_id",
    OLD."created_by_user_id",
    OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'automation artifact version snapshot content is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."validation_report" IS NOT NULL
     AND NEW."validation_report" IS DISTINCT FROM OLD."validation_report" THEN
    RAISE EXCEPTION 'automation artifact validation report is already finalized'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."security_report" IS NOT NULL
     AND NEW."security_report" IS DISTINCT FROM OLD."security_report" THEN
    RAISE EXCEPTION 'automation artifact security report is already finalized'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

--> statement-breakpoint
CREATE FUNCTION aw_learning_artifact_lifecycle_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status IN ('shadow','active') AND EXISTS (SELECT 1 FROM learning_retained_assets a JOIN automation_artifact_versions v ON v.company_id=a.company_id AND v.id=a.asset_id
 WHERE v.company_id=NEW.company_id AND v.artifact_id=NEW.id AND a.asset_type='automation_artifact_version' AND NOT aw_learning_link_current(a.company_id,a.candidate_link_id)) THEN RAISE EXCEPTION 'Learning artifact source changed' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_learning_artifact_lifecycle BEFORE INSERT OR UPDATE ON automation_artifacts FOR EACH ROW EXECUTE FUNCTION aw_learning_artifact_lifecycle_guard();
--> statement-breakpoint
CREATE FUNCTION aw_learning_optimizer_lineage_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE refs jsonb;
BEGIN
 SELECT coalesce(jsonb_agg(DISTINCT e.memory_record_id::text),'[]'::jsonb) INTO refs FROM learning_domain_candidates l
 JOIN learning_hypotheses h ON h.company_id=l.company_id AND h.id=l.hypothesis_id
 JOIN learning_evidence e ON e.company_id=h.company_id AND e.cycle_id=h.cycle_id
 WHERE l.company_id=NEW.company_id AND l.target_domain='automation_artifact' AND l.candidate_id=NEW.id;
 SELECT coalesce(jsonb_agg(DISTINCT value),'[]'::jsonb) INTO NEW.memory_record_ids FROM jsonb_array_elements(NEW.memory_record_ids||refs);
 IF aw_optimizer_artifact_erased(NEW.company_id,NEW.artifact_id) THEN
   NEW.status:='retired'; NEW.compiler_result:=NULL; NEW.replay_evaluation:=NULL; NEW.shadow_evaluation:=NULL; NEW.invariants:='[]'::jsonb;
 ELSIF NEW.status IN ('shadow','canary','active') AND NOT aw_learning_asset_current(NEW.company_id,'automation_artifact_version',NEW.artifact_version_id) THEN RAISE EXCEPTION 'Learning optimizer source changed' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aaa_learning_optimizer_lineage BEFORE INSERT OR UPDATE ON workflow_optimizer_evaluations FOR EACH ROW EXECUTE FUNCTION aw_learning_optimizer_lineage_guard();
--> statement-breakpoint
CREATE FUNCTION aw_learning_artifact_execution_lineage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE refs jsonb;
BEGIN
 IF NEW.automation_artifact_version_id IS NULL THEN RETURN NEW; END IF;
 SELECT coalesce(jsonb_agg(DISTINCT e.memory_record_id::text),'[]'::jsonb) INTO refs FROM learning_retained_assets a
 JOIN learning_domain_candidates l ON l.company_id=a.company_id AND l.id=a.candidate_link_id
 JOIN learning_hypotheses h ON h.company_id=l.company_id AND h.id=l.hypothesis_id
 JOIN learning_evidence e ON e.company_id=h.company_id AND e.cycle_id=h.cycle_id
 WHERE a.company_id=NEW.company_id AND a.asset_type='automation_artifact_version' AND a.asset_id=NEW.automation_artifact_version_id;
 SELECT coalesce(jsonb_agg(DISTINCT value),'[]'::jsonb) INTO NEW.memory_record_ids FROM jsonb_array_elements(NEW.memory_record_ids||refs);
 IF aw_learning_asset_erased(NEW.company_id,'automation_artifact_version',NEW.automation_artifact_version_id) THEN
   NEW.input_json:=NULL; NEW.output_json:=NULL; NEW.task_result_json:=NULL; NEW.error_message:=NULL;
   IF NEW.status NOT IN ('succeeded','failed','cancelled','skipped','retried') THEN NEW.status:='cancelled'; NEW.finished_at:=now(); END IF;
 ELSIF NOT aw_learning_asset_current(NEW.company_id,'automation_artifact_version',NEW.automation_artifact_version_id) AND NEW.status NOT IN ('cancelled','failed','cancelling') THEN RAISE EXCEPTION 'Learning artifact execution source changed' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aab_learning_artifact_step_lineage BEFORE INSERT OR UPDATE ON workflow_step_runs FOR EACH ROW EXECUTE FUNCTION aw_learning_artifact_execution_lineage();
