-- Custom SQL migration file, put your code below! --
-- The existing immutable Artifact version owns application sandbox files.
-- Capture only native identities, even when no consumer transaction survived.
CREATE FUNCTION aw_artifact_workspace_source_erasure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM companies WHERE id=OLD.company_id) THEN RETURN OLD; END IF;
 IF TG_OP='UPDATE' AND NOT (aw_learning_asset_erased(NEW.company_id,'automation_artifact_version',NEW.id)
   OR aw_optimizer_artifact_erased(NEW.company_id,NEW.artifact_id)) THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('business-events:'||OLD.company_id::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('memory:privacy:'||OLD.company_id::text,0));
 INSERT INTO memory_jobs(company_id,operation_type,job_key,source_ref_json)
  VALUES(OLD.company_id,'retention','artifact-workspace-erasure:v1:'||OLD.id::text,
    jsonb_build_object('kind','artifact_workspace_erasure','versionId',OLD.id::text)) ON CONFLICT DO NOTHING;
 UPDATE memory_jobs SET status='queued',finished_at=NULL,result_json=NULL,result_summary=NULL,error=NULL,error_code=NULL,
   source_ref_json=jsonb_build_object('kind','artifact_workspace_erasure','versionId',OLD.id::text),updated_at=now()
  WHERE company_id=OLD.company_id AND job_key='artifact-workspace-erasure:v1:'||OLD.id::text AND attempt_number=1
   AND status IN ('succeeded','failed','cancelled');
 IF TG_OP='UPDATE' THEN RETURN NEW; END IF;
 RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_artifact_workspace_deleted BEFORE DELETE ON automation_artifact_versions
 FOR EACH ROW EXECUTE FUNCTION aw_artifact_workspace_source_erasure();
--> statement-breakpoint
CREATE TRIGGER aw_artifact_workspace_source_erased AFTER UPDATE ON automation_artifact_versions
 FOR EACH ROW EXECUTE FUNCTION aw_artifact_workspace_source_erasure();
