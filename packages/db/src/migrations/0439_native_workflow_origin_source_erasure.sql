-- Actual native Workflow origins retain complete revision/Memory Source closure
-- even without waits or Artifact pins. Original Memory tombstones retain
-- selected child erasure after preparation-context fields are cleared.
CREATE OR REPLACE FUNCTION aw_workflow_memory_erased(company uuid, execution uuid, task uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  WITH native_scope AS (
    SELECT coalesce(task, (SELECT i.id FROM heartbeat_runs h
      JOIN issues i ON i.company_id=h.company_id AND i.id=h.native_issue_id
      WHERE h.company_id=company AND h.id=execution AND h.runtime_mode='native'
        AND (i.conversation_agent_id IS NOT NULL OR i.conversation_retired_at IS NOT NULL))) AS task_id
  )
  SELECT EXISTS(SELECT 1 FROM issues i WHERE i.company_id=company AND i.origin_kind='workflow_task'
    AND (i.id=task OR EXISTS(SELECT 1 FROM heartbeat_runs h WHERE h.company_id=company AND h.id=execution AND (h.native_issue_id=i.id OR (h.native_issue_id IS NULL AND coalesce(h.context_snapshot->>'issueId',h.context_snapshot->>'taskId')=i.id::text))))
    AND EXISTS(SELECT 1 FROM workflow_runs w WHERE w.company_id=company AND w.id::text=i.origin_run_id::text
      AND w.workflow_id::text=i.origin_id::text AND (
      aw_workflow_artifact_source_erased(company,w.id)
      OR aw_learning_asset_erased(company,'workflow_revision',w.workflow_revision_id)
      OR EXISTS(SELECT 1 FROM (
        SELECT jsonb_array_elements_text(w.memory_record_ids) AS id
        UNION ALL SELECT jsonb_array_elements_text(s.memory_record_ids) AS id
          FROM workflow_step_runs s WHERE s.company_id=company AND s.workflow_run_id=w.id
      ) ref WHERE NOT EXISTS(SELECT 1 FROM memory_records r WHERE r.company_id=company AND r.id::text=ref.id AND r.deleted_at IS NULL)
        OR EXISTS(SELECT 1 FROM memory_deletion_markers m WHERE m.company_id=company AND m.record_id::text=ref.id)))))
  OR EXISTS(SELECT 1 FROM memory_deletion_markers marker WHERE marker.company_id=company AND marker.kind='source'
    AND execution IS NOT NULL AND marker.key='memory-run-source-erasure:v1:'||execution::text)
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
