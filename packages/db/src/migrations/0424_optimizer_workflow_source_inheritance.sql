CREATE OR REPLACE FUNCTION aw_learning_optimizer_lineage_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE refs jsonb;
BEGIN
 -- Reuse original Learning links when compiling an actually retained Workflow.
 IF (SELECT count(DISTINCT candidate_link_id) FROM learning_retained_assets WHERE company_id=NEW.company_id AND asset_type='workflow_revision' AND asset_id=NEW.workflow_revision_id)>20 THEN
  RAISE EXCEPTION 'Optimizer Learning lineage exceeds its complete-set bound' USING ERRCODE='23514';
 END IF;
 INSERT INTO learning_retained_assets(company_id,candidate_link_id,asset_type,asset_id,erased_at)
 SELECT a.company_id,a.candidate_link_id,'automation_artifact_version',NEW.artifact_version_id,a.erased_at
 FROM learning_retained_assets a WHERE a.company_id=NEW.company_id AND a.asset_type='workflow_revision' AND a.asset_id=NEW.workflow_revision_id ON CONFLICT DO NOTHING;
 SELECT coalesce(jsonb_agg(DISTINCT e.memory_record_id::text),'[]'::jsonb) INTO refs FROM learning_domain_candidates l
 JOIN learning_hypotheses h ON h.company_id=l.company_id AND h.id=l.hypothesis_id
 JOIN learning_evidence e ON e.company_id=h.company_id AND e.cycle_id=h.cycle_id
 WHERE l.company_id=NEW.company_id AND l.target_domain='automation_artifact' AND l.candidate_id=NEW.id;
 SELECT coalesce(jsonb_agg(DISTINCT value),'[]'::jsonb) INTO NEW.memory_record_ids FROM jsonb_array_elements(NEW.memory_record_ids||refs);
 IF aw_optimizer_artifact_erased(NEW.company_id,NEW.artifact_id)
    OR aw_learning_asset_erased(NEW.company_id,'workflow_revision',NEW.workflow_revision_id)
    OR aw_learning_asset_erased(NEW.company_id,'automation_artifact_version',NEW.artifact_version_id) THEN
   NEW.status:='retired'; NEW.compiler_result:=NULL; NEW.replay_evaluation:=NULL; NEW.shadow_evaluation:=NULL; NEW.invariants:='[]'::jsonb;
 ELSIF NEW.status IN ('shadow','canary','active') AND (NOT aw_learning_asset_current(NEW.company_id,'workflow_revision',NEW.workflow_revision_id) OR NOT aw_learning_asset_current(NEW.company_id,'automation_artifact_version',NEW.artifact_version_id)) THEN RAISE EXCEPTION 'Learning optimizer source changed' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

--> statement-breakpoint
-- Backfill only actual persisted optimizer -> Workflow relationships.
INSERT INTO learning_retained_assets(company_id,candidate_link_id,asset_type,asset_id,erased_at)
SELECT a.company_id,a.candidate_link_id,'automation_artifact_version',e.artifact_version_id,a.erased_at
FROM workflow_optimizer_evaluations e JOIN learning_retained_assets a ON a.company_id=e.company_id AND a.asset_type='workflow_revision' AND a.asset_id=e.workflow_revision_id
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Existing native guards scrub historical compiler payloads before a worker runs.
UPDATE workflow_optimizer_evaluations SET updated_at=updated_at
WHERE aw_learning_asset_erased(company_id,'automation_artifact_version',artifact_version_id);
--> statement-breakpoint
UPDATE automation_artifact_versions SET source_code=source_code
WHERE aw_learning_asset_erased(company_id,'automation_artifact_version',id);
--> statement-breakpoint
-- Reconcile inherited historical derivatives through the original cycle outbox.
INSERT INTO memory_jobs(company_id,operation_type,job_key,source_ref_json)
SELECT DISTINCT c.company_id,'retention','learning-analytical-erasure:v1:'||c.id,jsonb_build_object('kind','learning_analytical_erasure','cycleId',c.id)
FROM learning_cycles c JOIN learning_hypotheses h ON h.company_id=c.company_id AND h.cycle_id=c.id
JOIN learning_domain_candidates l ON l.company_id=h.company_id AND l.hypothesis_id=h.id
JOIN learning_retained_assets a ON a.company_id=l.company_id AND a.candidate_link_id=l.id
JOIN workflow_optimizer_evaluations e ON e.company_id=a.company_id AND e.artifact_version_id=a.asset_id
WHERE c.erased_at IS NOT NULL AND a.asset_type='automation_artifact_version'
ON CONFLICT(company_id,job_key,attempt_number) DO UPDATE SET status='queued',execution_owner_id=NULL,lease_expires_at=NULL,finished_at=NULL,result_json=NULL,result_summary=NULL,error=NULL,error_code=NULL,updated_at=clock_timestamp()
WHERE memory_jobs.status IN('succeeded','failed','cancelled');
