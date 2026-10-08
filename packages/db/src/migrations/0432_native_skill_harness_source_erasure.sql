CREATE OR REPLACE FUNCTION aw_workflow_memory_erased(company uuid, execution uuid, task uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  WITH native_scope AS (
    SELECT coalesce(task, (SELECT i.id FROM heartbeat_runs h
      JOIN issues i ON i.company_id=h.company_id AND i.id=h.native_issue_id
      WHERE h.company_id=company AND h.id=execution AND h.runtime_mode='native'
        AND (i.conversation_agent_id IS NOT NULL OR i.conversation_retired_at IS NOT NULL))) AS task_id
  )
  SELECT EXISTS(SELECT 1 FROM company_skill_test_runs t WHERE t.company_id=company
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
    CROSS JOIN LATERAL jsonb_array_elements_text(s.memory_record_ids) ref(id)
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
      AND (aw_learning_asset_erased(company,'workflow_revision',parent.workflow_revision_id)
        OR (s.automation_artifact_version_id IS NOT NULL AND aw_learning_asset_erased(company,'automation_artifact_version',s.automation_artifact_version_id))
        OR NOT EXISTS (SELECT 1 FROM memory_records r
        WHERE r.company_id = company AND r.id::text = ref.id AND r.deleted_at IS NULL)
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
-- Custom SQL migration file, put your code below! --
CREATE OR REPLACE FUNCTION aw_skill_harness_source_erased(company uuid, version uuid, issue uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT aw_skill_version_source_erased(company,version)
   OR aw_workflow_memory_erased(company,NULL::uuid,issue)
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_skill_evaluation_source_erased(company uuid, evaluation uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM company_skill_eval_runs e WHERE e.company_id=company AND e.id=evaluation
   AND (aw_skill_version_source_erased(company,e.candidate_version_id)
     OR (e.champion_version_id IS NOT NULL AND aw_skill_version_source_erased(company,e.champion_version_id))
     OR EXISTS(SELECT 1 FROM company_skill_test_runs t WHERE t.company_id=company
       AND (t.evaluation_context->>'evaluationRunId'=e.id::text OR EXISTS(SELECT 1 FROM company_skill_eval_scores s WHERE s.company_id=company AND s.eval_run_id=e.id AND s.test_run_id=t.id))
       AND aw_skill_harness_source_erased(company,t.skill_version_id,t.issue_id))))
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_guard_skill_harness_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF aw_skill_harness_source_erased(NEW.company_id,NEW.skill_version_id,NEW.issue_id) THEN
   NEW.input_snapshot=''; NEW.agent_config_snapshot='{}'::jsonb;
   NEW.template_name=NULL; NEW.template_body=NULL; NEW.rendered_template_body=NULL;
   NEW.harness_issue_description=''; NEW.output_snapshot=''; NEW.error='Source payload erased'; NEW.status='cancelled';
   IF TG_OP='INSERT' AND aw_skill_version_source_erased(NEW.company_id,NEW.skill_version_id) THEN
     INSERT INTO memory_jobs(company_id,operation_type,job_key,source_ref_json)
     SELECT v.company_id,'retention','skill-version-file-erasure:v1:'||v.id::text,
       jsonb_build_object('kind','skill_version_file_erasure','skillId',v.company_skill_id,'versionId',v.id)
     FROM company_skill_versions v WHERE v.company_id=NEW.company_id AND v.company_skill_id=NEW.skill_id AND v.id=NEW.skill_version_id
     ON CONFLICT(company_id,job_key,attempt_number) DO UPDATE SET status='queued',finished_at=NULL,result_json=NULL,result_summary=NULL,error=NULL,error_code=NULL,updated_at=now();
   END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_native_skill_harness_source BEFORE INSERT OR UPDATE ON company_skill_test_runs
FOR EACH ROW EXECUTE FUNCTION aw_guard_skill_harness_source();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_guard_skill_evaluation_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF aw_skill_version_source_erased(NEW.company_id,NEW.candidate_version_id)
   OR (NEW.champion_version_id IS NOT NULL AND aw_skill_version_source_erased(NEW.company_id,NEW.champion_version_id))
   OR aw_skill_evaluation_source_erased(NEW.company_id,NEW.id) THEN
   NEW.agent_snapshot=NULL; NEW.aggregate=NULL; NEW.status='cancelled';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_native_skill_evaluation_source BEFORE INSERT OR UPDATE ON company_skill_eval_runs
FOR EACH ROW EXECUTE FUNCTION aw_guard_skill_evaluation_source();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_guard_skill_score_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF aw_skill_evaluation_source_erased(NEW.company_id,NEW.eval_run_id)
   OR EXISTS(SELECT 1 FROM company_skill_test_runs t WHERE t.company_id=NEW.company_id AND t.id=NEW.test_run_id
     AND aw_skill_harness_source_erased(t.company_id,t.skill_version_id,t.issue_id)) THEN
   NEW.scores='{"payloadDeleted":true}'::jsonb;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_native_skill_score_source BEFORE INSERT OR UPDATE ON company_skill_eval_scores
FOR EACH ROW EXECUTE FUNCTION aw_guard_skill_score_source();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_erase_skill_harness_sources(company uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 -- ponytail: original complete company sweep; narrow by native affected IDs
 -- if retained history makes this sweep exceed the worker budget.
 -- The original privacy owner holds company -> Memory; retain native IDs/FKs.
 UPDATE company_skill_test_runs t SET input_snapshot='',agent_config_snapshot='{}'::jsonb,template_name=NULL,template_body=NULL,
   rendered_template_body=NULL,harness_issue_description='',output_snapshot='',error='Source payload erased',status='cancelled'
 WHERE t.company_id=company AND aw_skill_harness_source_erased(company,t.skill_version_id,t.issue_id);
 UPDATE company_skill_eval_runs e SET agent_snapshot=NULL,aggregate=NULL,status='cancelled'
 WHERE e.company_id=company AND aw_skill_evaluation_source_erased(company,e.id);
 UPDATE company_skill_eval_scores s SET scores='{"payloadDeleted":true}'::jsonb
 WHERE s.company_id=company AND (aw_skill_evaluation_source_erased(company,s.eval_run_id)
   OR EXISTS(SELECT 1 FROM company_skill_test_runs t WHERE t.company_id=company AND t.id=s.test_run_id
     AND aw_skill_harness_source_erased(company,t.skill_version_id,t.issue_id)));
END $$;
--> statement-breakpoint
DO $$ DECLARE company uuid; BEGIN
 FOR company IN SELECT id FROM companies LOOP
   PERFORM pg_advisory_xact_lock(hashtextextended('business-events:' || company::text,0));
   PERFORM pg_advisory_xact_lock(hashtextextended('memory:privacy:' || company::text,0));
   PERFORM aw_erase_skill_harness_sources(company);
 END LOOP;
END $$;

--> statement-breakpoint
-- Revisit previously completed version jobs for historical pending harness Tasks.
INSERT INTO memory_jobs(company_id,operation_type,job_key,source_ref_json)
SELECT DISTINCT v.company_id,'retention','skill-version-file-erasure:v1:'||v.id::text,
 jsonb_build_object('kind','skill_version_file_erasure','skillId',v.company_skill_id,'versionId',v.id)
FROM company_skill_versions v JOIN company_skill_test_runs t ON t.company_id=v.company_id AND t.skill_version_id=v.id
WHERE aw_skill_version_source_erased(v.company_id,v.id)
ON CONFLICT(company_id,job_key,attempt_number) DO UPDATE SET status='queued',finished_at=NULL,result_json=NULL,result_summary=NULL,error=NULL,error_code=NULL,updated_at=now();
