-- Extend the existing native child-payload guards through persisted Workflow
-- and artifact ownership. Learning retains verified Memory roots; analytical
-- source erasure therefore must not delete those independent Memory records.
-- Native conversations own continuity across runs. Reuse the actual native
-- issue binding; no copied provider identity or new retention owner is created.
CREATE OR REPLACE FUNCTION aw_workflow_memory_erased(company uuid, execution uuid, task uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  WITH native_scope AS (
    SELECT coalesce(task, (SELECT i.id FROM heartbeat_runs h
      JOIN issues i ON i.company_id=h.company_id AND i.id=h.native_issue_id
      WHERE h.company_id=company AND h.id=execution AND h.runtime_mode='native'
        AND (i.conversation_agent_id IS NOT NULL OR i.conversation_retired_at IS NOT NULL))) AS task_id
  )
  SELECT EXISTS (SELECT 1 FROM issues i WHERE i.company_id=company AND i.conversation_retired_at IS NOT NULL
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
      AND ((execution IS NOT NULL AND c.run_id = execution) OR ((SELECT task_id FROM native_scope) IS NOT NULL AND c.issue_id = (SELECT task_id FROM native_scope)))
      AND (EXISTS (SELECT 1 FROM memory_deletion_markers m WHERE m.company_id = company AND m.record_id = r.memory_record_id)
        OR NOT EXISTS (SELECT 1 FROM memory_records source WHERE source.company_id = company AND source.id = r.memory_record_id AND source.deleted_at IS NULL))
  )
  OR EXISTS (
    SELECT 1 FROM context_manifest_memory_roots r
    JOIN context_manifests c ON c.company_id=r.company_id AND c.id=r.manifest_id
    JOIN analytical_context_roots a ON a.company_id=r.company_id AND a.memory_record_id=r.memory_record_id
    WHERE r.company_id=company AND ((execution IS NOT NULL AND c.run_id=execution) OR ((SELECT task_id FROM native_scope) IS NOT NULL AND c.issue_id=(SELECT task_id FROM native_scope)))
      AND (a.expires_at<=now() OR a.source_count<>(SELECT count(*) FROM analytical_context_dependencies d WHERE d.company_id=a.company_id AND d.memory_record_id=a.memory_record_id)
        OR EXISTS(SELECT 1 FROM analytical_context_dependencies d JOIN analytical_lineage_manifests s ON s.company_id=d.company_id AND s.id=d.source_manifest_id WHERE d.company_id=a.company_id AND d.memory_record_id=a.memory_record_id AND s.expires_at<=now()))
  );
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_learning_optimizer_lineage_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE refs jsonb;
BEGIN
 SELECT coalesce(jsonb_agg(DISTINCT e.memory_record_id::text),'[]'::jsonb) INTO refs FROM learning_domain_candidates l
 JOIN learning_hypotheses h ON h.company_id=l.company_id AND h.id=l.hypothesis_id
 JOIN learning_evidence e ON e.company_id=h.company_id AND e.cycle_id=h.cycle_id
 WHERE l.company_id=NEW.company_id AND l.target_domain='automation_artifact' AND l.candidate_id=NEW.id;
 SELECT coalesce(jsonb_agg(DISTINCT value),'[]'::jsonb) INTO NEW.memory_record_ids FROM jsonb_array_elements(NEW.memory_record_ids||refs);
 IF aw_optimizer_artifact_erased(NEW.company_id,NEW.artifact_id)
    OR aw_learning_asset_erased(NEW.company_id,'automation_artifact_version',NEW.artifact_version_id) THEN
   NEW.status:='retired'; NEW.compiler_result:=NULL; NEW.replay_evaluation:=NULL; NEW.shadow_evaluation:=NULL; NEW.invariants:='[]'::jsonb;
 ELSIF NEW.status IN ('shadow','canary','active') AND NOT aw_learning_asset_current(NEW.company_id,'automation_artifact_version',NEW.artifact_version_id) THEN RAISE EXCEPTION 'Learning optimizer source changed' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
