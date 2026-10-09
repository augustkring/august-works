-- Native version deletion follows actual retained inventory/profile consumers.
-- Source tombstones and cleanup reuse the original Memory privacy owners.
CREATE OR REPLACE FUNCTION aw_workflow_memory_erased(company uuid, execution uuid, task uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  WITH native_scope AS (
    SELECT coalesce(task, (SELECT i.id FROM heartbeat_runs h
      JOIN issues i ON i.company_id=h.company_id AND i.id=h.native_issue_id
      WHERE h.company_id=company AND h.id=execution AND h.runtime_mode='native'
        AND (i.conversation_agent_id IS NOT NULL OR i.conversation_retired_at IS NOT NULL))) AS task_id
  )
  SELECT EXISTS(SELECT 1 FROM memory_deletion_markers marker WHERE marker.company_id=company AND marker.kind='source'
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
CREATE FUNCTION aw_native_skill_source_run_erasure() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE execution uuid;
BEGIN
 IF TG_OP='UPDATE' AND NOT aw_skill_version_source_erased(OLD.company_id,OLD.id) THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('business-events:'||OLD.company_id::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('memory:privacy:'||OLD.company_id::text,0));
 FOR execution IN
  SELECT h.id FROM heartbeat_runs h WHERE h.company_id=OLD.company_id AND EXISTS(
   SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(h.runner_profile_json #> '{nativeExecutionInput,runtimeContext,skills}')='array'
    THEN h.runner_profile_json #> '{nativeExecutionInput,runtimeContext,skills}' ELSE '[]'::jsonb END) s
   WHERE s->>'versionId'=OLD.id::text)
  UNION SELECT e.run_id FROM agent_execution_manifests e JOIN agent_execution_manifest_items i ON i.company_id=e.company_id AND i.manifest_id=e.id
   WHERE e.company_id=OLD.company_id AND i.type='skill' AND i.ref=OLD.company_skill_id::text AND i.version_ref=OLD.id::text
 LOOP
  INSERT INTO memory_deletion_markers(company_id,key,kind)
   VALUES(OLD.company_id,'native-runtime-source-version-erasure:v1:'||execution::text||':'||OLD.id::text,'source') ON CONFLICT DO NOTHING;
  INSERT INTO memory_jobs(company_id,operation_type,job_key,source_ref_json)
   VALUES(OLD.company_id,'retention','runtime-skill-source-erasure:v1:'||execution::text||':'||OLD.id::text,
    jsonb_build_object('kind','runtime_skill_source_erasure','runId',execution::text,'versionId',OLD.id::text)) ON CONFLICT DO NOTHING;
 END LOOP;
 IF TG_OP='UPDATE' THEN RETURN NEW; END IF;
 RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER aaa_native_skill_source_run_erasure BEFORE DELETE ON company_skill_versions
 FOR EACH ROW EXECUTE FUNCTION aw_native_skill_source_run_erasure();

--> statement-breakpoint
CREATE TRIGGER aaa_native_skill_source_run_payload_erasure BEFORE UPDATE ON company_skill_versions
 FOR EACH ROW EXECUTE FUNCTION aw_native_skill_source_run_erasure();
