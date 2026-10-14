-- A saved copy retains its Original owner. Changing a parent/tenant/revision
-- reference during restore must not reclassify an erased private payload as
-- material from an unrelated public workflow or execution.
-- New rows verify scoped parents. An unchanged owner needs no extra parent
-- lock on ordinary updates; this preserves Native lease/cleanup lock order.
CREATE FUNCTION aw_guard_workflow_copy_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME IN ('workflows','automation_artifacts') THEN
   IF TG_OP='UPDATE' AND (NEW.id,NEW.company_id) IS DISTINCT FROM (OLD.id,OLD.company_id) THEN
     RAISE EXCEPTION 'Native workflow identity cannot be retargeted' USING ERRCODE='23514';
   END IF;
 ELSIF TG_TABLE_NAME='workflow_revisions' THEN
   IF TG_OP='UPDATE' AND (NEW.id,NEW.company_id,NEW.workflow_id) IS DISTINCT FROM (OLD.id,OLD.company_id,OLD.workflow_id) THEN
     RAISE EXCEPTION 'Native workflow revision owner cannot be retargeted' USING ERRCODE='23514';
   END IF;
   IF TG_OP='UPDATE' THEN RETURN NEW; END IF;
   PERFORM 1 FROM workflows w WHERE w.company_id=NEW.company_id AND w.id=NEW.workflow_id FOR KEY SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Native workflow revision owner is unavailable' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='automation_artifact_versions' THEN
   IF TG_OP='UPDATE' AND (NEW.id,NEW.company_id,NEW.artifact_id) IS DISTINCT FROM (OLD.id,OLD.company_id,OLD.artifact_id) THEN
     RAISE EXCEPTION 'Native Artifact version owner cannot be retargeted' USING ERRCODE='23514';
   END IF;
   IF TG_OP='UPDATE' THEN RETURN NEW; END IF;
   PERFORM 1 FROM automation_artifacts a WHERE a.company_id=NEW.company_id AND a.id=NEW.artifact_id FOR KEY SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Native Artifact version owner is unavailable' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='workflow_runs' THEN
   IF TG_OP='UPDATE' AND (NEW.id,NEW.company_id,NEW.workflow_id,NEW.workflow_revision_id)
     IS DISTINCT FROM (OLD.id,OLD.company_id,OLD.workflow_id,OLD.workflow_revision_id) THEN
     RAISE EXCEPTION 'Native workflow execution owner cannot be retargeted' USING ERRCODE='23514';
   END IF;
   IF TG_OP='UPDATE' THEN RETURN NEW; END IF;
   PERFORM 1 FROM workflow_revisions r JOIN workflows w ON w.company_id=r.company_id AND w.id=r.workflow_id
     WHERE r.company_id=NEW.company_id AND r.id=NEW.workflow_revision_id AND r.workflow_id=NEW.workflow_id FOR KEY SHARE OF r,w;
   IF NOT FOUND THEN RAISE EXCEPTION 'Native workflow execution revision owner is unavailable' USING ERRCODE='23514'; END IF;
 ELSE
   IF TG_OP='UPDATE' AND (NEW.id,NEW.company_id,NEW.workflow_run_id) IS DISTINCT FROM (OLD.id,OLD.company_id,OLD.workflow_run_id) THEN
     RAISE EXCEPTION 'Native workflow copy owner cannot be retargeted' USING ERRCODE='23514';
   END IF;
   IF TG_OP='UPDATE' THEN RETURN NEW; END IF;
   PERFORM 1 FROM workflow_runs r WHERE r.company_id=NEW.company_id AND r.id=NEW.workflow_run_id FOR KEY SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Native workflow copy execution owner is unavailable' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aaa_workflow_copy_identity_guard BEFORE UPDATE ON workflows
 FOR EACH ROW EXECUTE FUNCTION aw_guard_workflow_copy_identity();
--> statement-breakpoint
CREATE TRIGGER aaa_workflow_copy_identity_guard BEFORE INSERT OR UPDATE ON workflow_revisions
 FOR EACH ROW EXECUTE FUNCTION aw_guard_workflow_copy_identity();
--> statement-breakpoint
CREATE TRIGGER aaa_workflow_copy_identity_guard BEFORE INSERT OR UPDATE ON workflow_runs
 FOR EACH ROW EXECUTE FUNCTION aw_guard_workflow_copy_identity();
--> statement-breakpoint
CREATE TRIGGER aaa_workflow_copy_identity_guard BEFORE INSERT OR UPDATE ON workflow_step_runs
 FOR EACH ROW EXECUTE FUNCTION aw_guard_workflow_copy_identity();
--> statement-breakpoint
CREATE TRIGGER aaa_workflow_copy_identity_guard BEFORE INSERT OR UPDATE ON workflow_waits
 FOR EACH ROW EXECUTE FUNCTION aw_guard_workflow_copy_identity();
--> statement-breakpoint
CREATE TRIGGER aaa_workflow_copy_identity_guard BEFORE INSERT OR UPDATE ON workflow_run_reviews
 FOR EACH ROW EXECUTE FUNCTION aw_guard_workflow_copy_identity();
--> statement-breakpoint
CREATE TRIGGER aaa_workflow_copy_identity_guard BEFORE UPDATE ON automation_artifacts
 FOR EACH ROW EXECUTE FUNCTION aw_guard_workflow_copy_identity();
--> statement-breakpoint
CREATE TRIGGER aaa_workflow_copy_identity_guard BEFORE INSERT OR UPDATE ON automation_artifact_versions
 FOR EACH ROW EXECUTE FUNCTION aw_guard_workflow_copy_identity();
