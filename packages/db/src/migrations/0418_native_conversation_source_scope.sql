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
      AND (NOT EXISTS (SELECT 1 FROM memory_records r
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
CREATE OR REPLACE FUNCTION aw_erase_workflow_agent_payload() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE task_id uuid; target_document_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'heartbeat_runs' THEN
    -- BEFORE INSERT/UPDATE must inspect NEW: its native binding may not yet
    -- exist in heartbeat_runs, or may still be the pre-selection legacy row.
    task_id := CASE WHEN NEW.runtime_mode='native' AND EXISTS (
      SELECT 1 FROM issues i WHERE i.company_id=NEW.company_id AND i.id=NEW.native_issue_id
        AND (i.conversation_agent_id IS NOT NULL OR i.conversation_retired_at IS NOT NULL)
    ) THEN NEW.native_issue_id ELSE NULL END;
    IF aw_workflow_memory_erased(NEW.company_id, NEW.id, task_id) THEN
      NEW.context_snapshot := '{}'::jsonb; NEW.result_json := NULL; NEW.runner_profile_json := NULL;
      NEW.stdout_excerpt := NULL; NEW.stderr_excerpt := NULL; NEW.error := NULL;
      NEW.log_ref := NULL; NEW.log_store := NULL; NEW.log_bytes := NULL; NEW.log_sha256 := NULL;
    END IF;
  ELSIF TG_TABLE_NAME = 'heartbeat_run_events' THEN
    IF aw_workflow_memory_erased(NEW.company_id, NEW.run_id, NULL) THEN
      NEW.message := NULL; NEW.payload := NULL;
    END IF;
  ELSIF TG_TABLE_NAME = 'agent_wakeup_requests' THEN
    IF EXISTS (SELECT 1 FROM heartbeat_runs h WHERE h.company_id = NEW.company_id
      AND h.wakeup_request_id = NEW.id AND aw_workflow_memory_erased(NEW.company_id, h.id, NULL)) THEN
      NEW.payload := '{}'::jsonb; NEW.error := NULL;
    END IF;
  ELSIF TG_TABLE_NAME = 'issues' THEN
    IF aw_workflow_memory_erased(NEW.company_id, NULL, NEW.id) THEN
      NEW.title := 'Erased workflow task'; NEW.description := NULL;
    END IF;
  ELSIF TG_TABLE_NAME = 'issue_comments' THEN
    IF aw_workflow_memory_erased(NEW.company_id, NULL, NEW.issue_id) THEN
      NEW.body := 'Source payload erased';
    END IF;
  ELSIF TG_TABLE_NAME IN ('native_run_results', 'work_assessments', 'status_decisions', 'native_run_finalizations') THEN
    IF aw_workflow_memory_erased(NEW.company_id, NEW.run_id, NULL) THEN
      IF TG_TABLE_NAME = 'native_run_results' THEN NEW.result_json := '{"payloadDeleted":true}'::jsonb;
      ELSIF TG_TABLE_NAME = 'work_assessments' THEN NEW.assessment_json := '{"payloadDeleted":true}'::jsonb;
      ELSIF TG_TABLE_NAME = 'status_decisions' THEN NEW.decision_json := '{"payloadDeleted":true}'::jsonb;
      ELSE NEW.failure_detail := NULL; NEW.recovery_history := '[]'::jsonb; END IF;
    END IF;
  ELSIF TG_TABLE_NAME IN ('agent_task_sessions', 'agent_runtime_state') THEN
    IF aw_workflow_memory_erased(NEW.company_id, NEW.last_run_id, NULL) THEN
      NEW.last_error := NULL;
      IF TG_TABLE_NAME = 'agent_task_sessions' THEN
        NEW.session_params_json := NULL; NEW.session_display_id := NULL; NEW.goal_json := NULL; NEW.goal_capability_json := NULL;
      ELSE NEW.state_json := '{}'::jsonb; NEW.session_id := NULL; END IF;
    END IF;
  ELSIF TG_TABLE_NAME IN ('completion_contracts', 'issue_work_products') THEN
    IF aw_workflow_memory_erased(NEW.company_id, NULL, NEW.issue_id) THEN
      IF TG_TABLE_NAME = 'completion_contracts' THEN NEW.contract_json := '{"payloadDeleted":true}'::jsonb;
      ELSE NEW.title := 'Erased workflow output'; NEW.url := NULL; NEW.external_id := NULL; NEW.summary := NULL; NEW.metadata := '{}'::jsonb; NEW.source_trust := NULL; END IF;
    END IF;
  ELSE
    IF TG_TABLE_NAME = 'documents'  THEN target_document_id := NEW.id; ELSE target_document_id := NEW.document_id; END IF;
    SELECT d.issue_id INTO task_id FROM issue_documents d WHERE d.company_id = NEW.company_id
      AND d.document_id = target_document_id LIMIT 1;
    IF task_id IS NOT NULL AND aw_workflow_memory_erased(NEW.company_id, NULL, task_id) THEN
      NEW.title := NULL;
      IF TG_TABLE_NAME = 'documents' THEN NEW.latest_body := ''; ELSE NEW.body := ''; NEW.change_summary := NULL; END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
