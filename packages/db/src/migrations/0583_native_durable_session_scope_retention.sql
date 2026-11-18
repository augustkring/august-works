-- PRIV-R8. The executor records each controller durable session folder's
-- scope digest on its Run (runner_profile_json.nativeDurableSessionScope)
-- before it creates the folder. Source erasure scrubs the Run profile; keep
-- that content-free record so the queued erasure, purge, offboarding and Run
-- deletion still find a folder that a crash left without a runner identity.
-- Everything else this function scrubs is unchanged from 0488.
CREATE OR REPLACE FUNCTION aw_erase_workflow_agent_payload() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE task_id uuid; target_document_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'heartbeat_runs' THEN
    -- BEFORE INSERT/UPDATE must inspect NEW: its native binding may not yet
    -- exist in heartbeat_runs, or may still be the pre-selection legacy row.
    task_id := CASE WHEN NEW.runtime_mode='native' THEN NEW.native_issue_id ELSE NULL END;
    IF aw_workflow_memory_erased(NEW.company_id, NEW.id, task_id) THEN
      NEW.context_snapshot := '{}'::jsonb; NEW.result_json := NULL;
      -- PRIV-R8: keep only the content-free durable session folder record
      -- (scope digests and session id) so erasure can still find the folder.
      NEW.runner_profile_json := CASE
        WHEN jsonb_typeof(NEW.runner_profile_json->'nativeDurableSessionScope') = 'object'
        THEN jsonb_build_object('nativeDurableSessionScope', NEW.runner_profile_json->'nativeDurableSessionScope')
        ELSE NULL END;
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
