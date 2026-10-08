-- Actual native Artifact version pins own all copied payloads in their Workflow Run.
CREATE FUNCTION aw_artifact_version_source_erased(company uuid, version uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT NOT EXISTS(SELECT 1 FROM automation_artifact_versions v WHERE v.company_id=company AND v.id=version)
 OR aw_learning_asset_erased(company,'automation_artifact_version',version)
 OR EXISTS(SELECT 1 FROM automation_artifact_versions v WHERE v.company_id=company AND v.id=version
   AND aw_optimizer_artifact_erased(company,v.artifact_id))
$$;
--> statement-breakpoint
CREATE FUNCTION aw_workflow_artifact_source_erased(company uuid, execution uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM workflow_step_runs s WHERE s.company_id=company AND s.workflow_run_id=execution
   AND s.automation_artifact_version_id IS NOT NULL AND aw_artifact_version_source_erased(company,s.automation_artifact_version_id))
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_workflow_memory_erased(company uuid, execution uuid, task uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  WITH native_scope AS (
    SELECT coalesce(task, (SELECT i.id FROM heartbeat_runs h
      JOIN issues i ON i.company_id=h.company_id AND i.id=h.native_issue_id
      WHERE h.company_id=company AND h.id=execution AND h.runtime_mode='native'
        AND (i.conversation_agent_id IS NOT NULL OR i.conversation_retired_at IS NOT NULL))) AS task_id
  )
  SELECT EXISTS(SELECT 1 FROM issues i WHERE i.company_id=company AND i.origin_kind='workflow_task'
    AND (i.id=task OR EXISTS(SELECT 1 FROM heartbeat_runs h WHERE h.company_id=company AND h.id=execution AND h.native_issue_id=i.id))
    AND EXISTS(SELECT 1 FROM workflow_runs w WHERE w.company_id=company AND w.id::text=i.origin_run_id::text
      AND w.workflow_id::text=i.origin_id::text AND aw_workflow_artifact_source_erased(company,w.id)))
  OR EXISTS(SELECT 1 FROM company_skill_test_runs t WHERE t.company_id=company
    AND (t.issue_id=task OR (execution IS NOT NULL AND EXISTS(SELECT 1 FROM heartbeat_runs h WHERE h.company_id=company AND h.id=execution
      AND (h.native_issue_id=t.issue_id OR EXISTS(SELECT 1 FROM agent_execution_manifests e JOIN context_manifests c ON c.company_id=e.company_id AND c.id=e.context_manifest_id WHERE e.company_id=company AND e.run_id=h.id AND c.issue_id=t.issue_id)))))
    AND aw_skill_version_source_erased(company,t.skill_version_id))
  OR EXISTS(SELECT 1 FROM memory_deletion_markers marker WHERE marker.company_id=company AND marker.kind='source'
    AND ((execution IS NOT NULL AND marker.key LIKE 'native-runtime-source-version-erasure:v1:'||execution::text||':%')
      OR (task IS NOT NULL AND EXISTS(SELECT 1 FROM heartbeat_runs h WHERE h.company_id=company AND (h.native_issue_id=task OR EXISTS(SELECT 1 FROM context_manifests c WHERE c.company_id=company AND c.issue_id=task AND (c.run_id=h.id OR EXISTS(SELECT 1 FROM agent_execution_manifests e WHERE e.company_id=company AND e.run_id=h.id AND e.context_manifest_id=c.id))))
        AND marker.key LIKE 'native-runtime-source-version-erasure:v1:'||h.id::text||':%'))))
  OR EXISTS (SELECT 1 FROM issues i WHERE i.company_id=company AND i.conversation_retired_at IS NOT NULL
    AND (((SELECT task_id FROM native_scope) IS NOT NULL AND i.id=(SELECT task_id FROM native_scope)) OR (execution IS NOT NULL AND EXISTS(SELECT 1 FROM heartbeat_runs h WHERE h.company_id=company AND h.id=execution AND h.native_issue_id=i.id))))
  OR EXISTS (
    SELECT 1 FROM workflow_step_runs s
    JOIN workflow_runs parent ON parent.company_id=s.company_id AND parent.id=s.workflow_run_id
    LEFT JOIN LATERAL jsonb_array_elements_text(s.memory_record_ids) ref(id) ON true
    WHERE s.company_id = company
      AND ((execution IS NOT NULL AND (s.heartbeat_run_id = execution OR EXISTS (
        SELECT 1 FROM heartbeat_runs h JOIN agent_wakeup_requests a ON a.company_id = h.company_id AND a.id = h.wakeup_request_id
        WHERE h.company_id = company AND h.id = execution AND (
          a.idempotency_key = 'workflow-direct-agent:' || s.id::text OR EXISTS (
            SELECT 1 FROM workflow_waits w WHERE w.company_id = company AND w.workflow_run_id = s.workflow_run_id
              AND w.node_id = s.node_id AND w.reference_type = 'issue' AND w.reference_id = a.payload->>'issueId')))))
        OR ((SELECT task_id FROM native_scope) IS NOT NULL AND EXISTS (
          SELECT 1 FROM workflow_waits w WHERE w.company_id = company
            AND w.workflow_run_id = s.workflow_run_id AND w.node_id = s.node_id
            AND w.reference_type = 'issue' AND w.reference_id = (SELECT task_id FROM native_scope)::text)))
      AND (aw_workflow_artifact_source_erased(company,s.workflow_run_id)
        OR aw_learning_asset_erased(company,'workflow_revision',parent.workflow_revision_id)
        OR (s.automation_artifact_version_id IS NOT NULL AND aw_learning_asset_erased(company,'automation_artifact_version',s.automation_artifact_version_id))
        OR (ref.id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM memory_records r
        WHERE r.company_id = company AND r.id::text = ref.id AND r.deleted_at IS NULL))
        OR EXISTS (SELECT 1 FROM memory_deletion_markers m
          WHERE m.company_id = company AND m.record_id::text = ref.id))
  )
  OR EXISTS (
    SELECT 1 FROM context_manifest_memory_roots r
    JOIN context_manifests c ON c.company_id = r.company_id AND c.id = r.manifest_id
    WHERE r.company_id = company
      AND ((execution IS NOT NULL AND (c.run_id = execution OR EXISTS (SELECT 1 FROM agent_execution_manifests e WHERE e.company_id=company AND e.run_id=execution AND e.context_manifest_id=c.id))) OR ((SELECT task_id FROM native_scope) IS NOT NULL AND c.issue_id = (SELECT task_id FROM native_scope)))
      AND (EXISTS (SELECT 1 FROM memory_deletion_markers m WHERE m.company_id = company AND m.record_id = r.memory_record_id)
        OR NOT EXISTS (SELECT 1 FROM memory_records source WHERE source.company_id = company AND source.id = r.memory_record_id AND source.deleted_at IS NULL))
  )
  OR EXISTS (
    SELECT 1 FROM context_manifest_memory_roots r
    JOIN context_manifests c ON c.company_id=r.company_id AND c.id=r.manifest_id
    JOIN analytical_context_roots a ON a.company_id=r.company_id AND a.memory_record_id=r.memory_record_id
    WHERE r.company_id=company AND ((execution IS NOT NULL AND (c.run_id=execution OR EXISTS (SELECT 1 FROM agent_execution_manifests e WHERE e.company_id=company AND e.run_id=execution AND e.context_manifest_id=c.id))) OR ((SELECT task_id FROM native_scope) IS NOT NULL AND c.issue_id=(SELECT task_id FROM native_scope)))
      AND (a.expires_at<=now() OR a.source_count<>(SELECT count(*) FROM analytical_context_dependencies d WHERE d.company_id=a.company_id AND d.memory_record_id=a.memory_record_id)
        OR EXISTS(SELECT 1 FROM analytical_context_dependencies d JOIN analytical_lineage_manifests s ON s.company_id=d.company_id AND s.id=d.source_manifest_id WHERE d.company_id=a.company_id AND d.memory_record_id=a.memory_record_id AND s.expires_at<=now()))
  );
$$;



--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_learning_artifact_execution_lineage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE refs jsonb;
BEGIN
 IF TG_OP='UPDATE' AND OLD.automation_artifact_version_id IS NOT NULL
   AND ROW(NEW.company_id,NEW.workflow_run_id,NEW.automation_artifact_version_id)
     IS DISTINCT FROM ROW(OLD.company_id,OLD.workflow_run_id,OLD.automation_artifact_version_id) THEN
   RAISE EXCEPTION 'Native Workflow Artifact binding is immutable' USING ERRCODE='23514';
 END IF;
 IF NEW.automation_artifact_version_id IS NULL THEN RETURN NEW; END IF;
 IF (TG_OP='INSERT' OR OLD.automation_artifact_version_id IS NULL) AND NOT EXISTS(
   SELECT 1 FROM automation_artifact_versions v WHERE v.company_id=NEW.company_id AND v.id=NEW.automation_artifact_version_id) THEN
   RAISE EXCEPTION 'Native Workflow Artifact binding is unavailable' USING ERRCODE='23514';
 END IF;
 SELECT coalesce(jsonb_agg(DISTINCT e.memory_record_id::text),'[]'::jsonb) INTO refs FROM learning_retained_assets a
 JOIN learning_domain_candidates l ON l.company_id=a.company_id AND l.id=a.candidate_link_id
 JOIN learning_hypotheses h ON h.company_id=l.company_id AND h.id=l.hypothesis_id
 JOIN learning_evidence e ON e.company_id=h.company_id AND e.cycle_id=h.cycle_id
 WHERE a.company_id=NEW.company_id AND a.asset_type='automation_artifact_version' AND a.asset_id=NEW.automation_artifact_version_id;
 SELECT coalesce(jsonb_agg(DISTINCT value),'[]'::jsonb) INTO NEW.memory_record_ids FROM jsonb_array_elements(NEW.memory_record_ids||refs);
 IF aw_artifact_version_source_erased(NEW.company_id,NEW.automation_artifact_version_id) THEN
   NEW.input_json:=NULL; NEW.output_json:=NULL; NEW.task_result_json:=NULL; NEW.error_message:=NULL;
   IF NEW.status NOT IN ('succeeded','failed','cancelled','skipped','retried') THEN NEW.status:='cancelled'; NEW.finished_at:=now(); END IF;
 ELSIF NOT aw_learning_asset_current(NEW.company_id,'automation_artifact_version',NEW.automation_artifact_version_id) AND NEW.status NOT IN ('cancelled','failed','cancelling') THEN RAISE EXCEPTION 'Learning artifact execution source changed' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

--> statement-breakpoint
CREATE FUNCTION aw_guard_workflow_artifact_copy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE execution uuid;
BEGIN
 IF TG_TABLE_NAME='workflow_runs' THEN execution=NEW.id; ELSE execution=NEW.workflow_run_id; END IF;
 IF aw_workflow_artifact_source_erased(NEW.company_id,execution) THEN
   IF TG_TABLE_NAME='workflow_runs' THEN
     NEW.trigger_payload='{}'::jsonb; NEW.failure_message=NULL;
     IF NEW.status IN ('queued','running','waiting','recovering') THEN
       NEW.status='cancelling'; NEW.execution_owner_id=NULL; NEW.lease_expires_at=NULL; NEW.owner_heartbeat_at=NULL;
     END IF;
   ELSIF TG_TABLE_NAME='workflow_step_runs' THEN
     NEW.input_json=NULL; NEW.output_json=NULL; NEW.task_result_json=NULL; NEW.error_message=NULL;
     IF NEW.status NOT IN ('succeeded','failed','cancelled','skipped','retried') THEN NEW.status='cancelled'; NEW.finished_at=now(); END IF;
   ELSE NEW.resolution_json=NULL;
   END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aac_workflow_artifact_copy BEFORE INSERT OR UPDATE ON workflow_runs
 FOR EACH ROW EXECUTE FUNCTION aw_guard_workflow_artifact_copy();
--> statement-breakpoint
CREATE TRIGGER aac_workflow_artifact_copy BEFORE INSERT OR UPDATE ON workflow_step_runs
 FOR EACH ROW EXECUTE FUNCTION aw_guard_workflow_artifact_copy();
--> statement-breakpoint
CREATE TRIGGER aac_workflow_artifact_copy BEFORE INSERT OR UPDATE ON workflow_waits
 FOR EACH ROW EXECUTE FUNCTION aw_guard_workflow_artifact_copy();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_artifact_workspace_source_erasure() RETURNS trigger LANGUAGE plpgsql AS $$
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
 IF EXISTS(SELECT 1 FROM workflow_step_runs s WHERE s.company_id=OLD.company_id AND s.automation_artifact_version_id=OLD.id) THEN
   INSERT INTO memory_jobs(company_id,operation_type,job_key,source_ref_json)
    VALUES(OLD.company_id,'retention','workflow-artifact-source-erasure:v1:'||OLD.id::text,
      jsonb_build_object('kind','workflow_artifact_source_erasure','versionId',OLD.id::text))
    ON CONFLICT(company_id,job_key,attempt_number) DO UPDATE SET status='queued',finished_at=NULL,
      result_json=NULL,result_summary=NULL,error=NULL,error_code=NULL,updated_at=now()
    WHERE memory_jobs.status IN ('succeeded','failed','cancelled');
 END IF;
 IF TG_OP='UPDATE' THEN RETURN NEW; END IF;
 RETURN OLD;
END $$;

--> statement-breakpoint
-- Reconcile retained historical consumers through the original IDs-only worker.
INSERT INTO memory_jobs(company_id,operation_type,job_key,source_ref_json)
SELECT DISTINCT s.company_id,'retention','workflow-artifact-source-erasure:v1:'||s.automation_artifact_version_id::text,
 jsonb_build_object('kind','workflow_artifact_source_erasure','versionId',s.automation_artifact_version_id::text)
FROM workflow_step_runs s WHERE s.automation_artifact_version_id IS NOT NULL
 AND aw_artifact_version_source_erased(s.company_id,s.automation_artifact_version_id)
ON CONFLICT(company_id,job_key,attempt_number) DO UPDATE SET status='queued',finished_at=NULL,
 result_json=NULL,result_summary=NULL,error=NULL,error_code=NULL,updated_at=now();
