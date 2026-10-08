-- The original evaluation FK owns historical Shadow payloads; actual native
-- Run/revision/node relationships qualify new copies. Keep receipt metadata.
CREATE FUNCTION aw_optimizer_observation_source_erased(company uuid, evaluation uuid, execution uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT NOT EXISTS(SELECT 1 FROM workflow_optimizer_evaluations e WHERE e.company_id=company AND e.id=evaluation)
 OR EXISTS(SELECT 1 FROM workflow_optimizer_evaluations e WHERE e.company_id=company AND e.id=evaluation
   AND (aw_artifact_version_source_erased(company,e.artifact_version_id)
     OR aw_learning_asset_erased(company,'workflow_revision',e.workflow_revision_id)))
 OR aw_workflow_artifact_source_erased(company,execution)
$$;
--> statement-breakpoint
-- Historical malformed associations cannot retain an admitted payload. This
-- is content erasure, not a reconstruction of execution evidence or version pins.
UPDATE workflow_optimizer_observations o SET shadow_result=NULL
WHERE aw_optimizer_observation_source_erased(o.company_id,o.evaluation_id,o.workflow_run_id)
 OR NOT EXISTS(SELECT 1 FROM workflow_optimizer_evaluations e JOIN workflow_runs w
   ON w.company_id=e.company_id AND w.workflow_id=e.workflow_id AND w.workflow_revision_id=e.workflow_revision_id
   WHERE e.company_id=o.company_id AND e.id=o.evaluation_id AND w.id=o.workflow_run_id AND e.node_id=o.node_id);
--> statement-breakpoint
CREATE FUNCTION aw_guard_optimizer_observation_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND ROW(NEW.company_id,NEW.evaluation_id,NEW.workflow_run_id,NEW.node_id)
   IS DISTINCT FROM ROW(OLD.company_id,OLD.evaluation_id,OLD.workflow_run_id,OLD.node_id) THEN
   RAISE EXCEPTION 'Native Optimizer observation Source binding is immutable' USING ERRCODE='23514';
 END IF;
 IF aw_optimizer_observation_source_erased(NEW.company_id,NEW.evaluation_id,NEW.workflow_run_id) THEN
   NEW.shadow_result=NULL;
 ELSIF NEW.shadow_result IS NOT NULL AND NOT EXISTS(SELECT 1 FROM workflow_optimizer_evaluations e JOIN workflow_runs w
   ON w.company_id=e.company_id AND w.workflow_id=e.workflow_id AND w.workflow_revision_id=e.workflow_revision_id
   WHERE e.company_id=NEW.company_id AND e.id=NEW.evaluation_id AND w.id=NEW.workflow_run_id AND e.node_id=NEW.node_id) THEN
   RAISE EXCEPTION 'Native Optimizer observation Source is unavailable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_native_optimizer_observation_source BEFORE INSERT OR UPDATE ON workflow_optimizer_observations
 FOR EACH ROW EXECUTE FUNCTION aw_guard_optimizer_observation_source();
