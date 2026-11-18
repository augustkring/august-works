-- PRIV-R8. The executor records each controller durable session folder's
-- scope digest on its Run (runner_profile_json.nativeDurableSessionScope)
-- before it creates the folder. Source erasure scrubs the Run profile; keep
-- that content-free record so the queued erasure, purge, offboarding and Run
-- deletion still find a folder that a crash left without a runner identity.
-- Everything else this function scrubs is unchanged from 0488, and the 0545
-- input receipt guard accepts that record as a cleared profile.

-- The only profile an erased Run may keep: exactly the content-free durable
-- session folder record (schema, server session id, 1-16 scope digests).
-- Anything else is still scrubbed to NULL or {} and a malformed record is
-- never kept.
CREATE OR REPLACE FUNCTION public.aw_native_durable_session_scope_only(p_profile jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT coalesce(
    jsonb_typeof(p_profile) = 'object'
    AND (SELECT array_agg(k ORDER BY k COLLATE "C") FROM jsonb_object_keys(p_profile) k) = ARRAY['nativeDurableSessionScope']
    AND jsonb_typeof(p_profile->'nativeDurableSessionScope') = 'object'
    AND (SELECT array_agg(k ORDER BY k COLLATE "C") FROM jsonb_object_keys(p_profile->'nativeDurableSessionScope') k)
      = ARRAY['normalizedSessionId','schema','scopeSha256']
    AND p_profile->'nativeDurableSessionScope'->>'schema' = 'paperclip.native-durable-session-scope.v1'
    AND jsonb_typeof(p_profile->'nativeDurableSessionScope'->'normalizedSessionId') = 'string'
    -- A Native session id (uuid) or the fallback `session-<Run id>` key.
    AND (p_profile->'nativeDurableSessionScope'->>'normalizedSessionId')
      ~* '^(session-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND jsonb_typeof(p_profile->'nativeDurableSessionScope'->'scopeSha256') = 'array'
    AND jsonb_array_length(p_profile->'nativeDurableSessionScope'->'scopeSha256') BETWEEN 1 AND 16
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_profile->'nativeDurableSessionScope'->'scopeSha256') d
      WHERE jsonb_typeof(d) <> 'string' OR NOT ((d #>> '{}') ~ '^[a-f0-9]{64}$')),
    false);
$$;
--> statement-breakpoint
-- The receipt guard lets an erased Run drop its native input receipt only
-- with a cleared profile; the retained folder record counts as cleared.
-- Exact copy of 0545 except those two profile conditions.
CREATE OR REPLACE FUNCTION public.aw_native_run_input_source_receipt_binding() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  profile jsonb := NEW.runner_profile_json;
  previous_profile jsonb;
  receipt jsonb;
  previous_receipt jsonb;
  erased boolean := false;
  binding jsonb;
  sources jsonb;
  policy jsonb;
  item jsonb;
  vector_name text;
  family text;
  allowed text[];
  captured_references text[] := ARRAY[]::text[];
  source_count integer;
  old_count integer;
  capture_index integer;
  first_dispatch jsonb;
  matching_dispatches integer;
BEGIN
  IF TG_OP='UPDATE' THEN previous_profile := OLD.runner_profile_json; END IF;
  receipt := nullif(profile->'nativeInputSourceReceipt','null'::jsonb);
  previous_receipt := nullif(previous_profile->'nativeInputSourceReceipt','null'::jsonb);

  IF NEW.native_input_source_protocol_version=1 THEN
    PERFORM 1 FROM public.memory_deletion_markers marker
      WHERE marker.company_id=NEW.company_id AND marker.kind='source'
        AND marker.key='memory-run-source-erasure:v1:' || NEW.id::text FOR KEY SHARE;
    erased := FOUND;
    IF erased AND (receipt IS NOT NULL OR profile ? 'nativeExecutionInput') THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Erased native run inputs cannot be restored';
    END IF;
  END IF;

  IF receipt IS NULL THEN
    -- Preserve the original workflow/native erasure owner, which can scrub a
    -- profile for actual erased Context, runtime-version or conversation roots
    -- before a run-specific marker exists. Only its canonical predicate can
    -- justify that full clear; retain the existing content-free marker so a
    -- later loss of the original source row cannot resurrect native input.
    IF NEW.native_input_source_protocol_version=1 AND NOT erased
      AND (profile IS NULL OR profile='{}'::jsonb OR public.aw_native_durable_session_scope_only(profile))
      AND public.aw_workflow_memory_erased(NEW.company_id,NEW.id,
        CASE WHEN NEW.runtime_mode='native' THEN NEW.native_issue_id ELSE NULL END) THEN
      IF TG_ARGV[0] IS DISTINCT FROM 'erasure' THEN
        INSERT INTO public.memory_deletion_markers(company_id,kind,key)
          VALUES(NEW.company_id,'source','memory-run-source-erasure:v1:' || NEW.id::text)
          ON CONFLICT(company_id,key) DO NOTHING;
        PERFORM 1 FROM public.memory_deletion_markers marker
          WHERE marker.company_id=NEW.company_id AND marker.kind='source'
            AND marker.key='memory-run-source-erasure:v1:' || NEW.id::text FOR KEY SHARE;
        IF NOT FOUND THEN
          RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Native run erasure marker conflict';
        END IF;
      END IF;
      erased := true;
    END IF;
    IF previous_receipt IS NOT NULL AND NOT
      (erased AND (profile IS NULL OR profile='{}'::jsonb OR public.aw_native_durable_session_scope_only(profile))) THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Native run input receipt cannot be removed';
    END IF;
    RETURN NEW;
  END IF;
  -- The early invocation sees attempted resurrection before existing erasure
  -- owners sanitize NEW. Final binding still runs after source-mutating owners.
  IF TG_ARGV[0]='erasure' THEN RETURN NEW; END IF;

  IF NEW.native_input_source_protocol_version<>1 OR NEW.runtime_mode<>'native'
    OR jsonb_typeof(profile->'nativeExecutionInput') IS DISTINCT FROM 'object'
    OR jsonb_typeof(receipt) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Native run input receipt requires a native protocol writer and input';
  END IF;
  IF octet_length(convert_to(receipt::text,'UTF8'))>2097152
    OR receipt->'version' IS DISTINCT FROM '1'::jsonb
    OR NOT receipt ?& ARRAY['version','binding','bootstrap','dispatches','additionalInputs','digest']
    OR receipt-ARRAY['version','binding','bootstrap','dispatches','additionalInputs','digest']<>'{}'::jsonb
    OR jsonb_typeof(receipt->'binding') IS DISTINCT FROM 'object'
    OR jsonb_typeof(receipt->'bootstrap') IS DISTINCT FROM 'object'
    OR jsonb_typeof(receipt->'dispatches') IS DISTINCT FROM 'array'
    OR jsonb_typeof(receipt->'additionalInputs') IS DISTINCT FROM 'array'
    OR jsonb_typeof(receipt->'digest') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Malformed native run input receipt';
  END IF;
  IF jsonb_array_length(receipt->'dispatches')>64 OR jsonb_array_length(receipt->'additionalInputs')>256
    OR receipt->>'digest' IS DISTINCT FROM encode(sha256(convert_to((receipt-'digest')::text,'UTF8')),'hex') THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Native run input receipt bounds or digest mismatch';
  END IF;

  binding := receipt->'binding';
  IF NOT binding ?& ARRAY['companyId','runId','agentId','responsibleUserId','issueId']
    OR binding-ARRAY['companyId','runId','agentId','responsibleUserId','issueId']<>'{}'::jsonb
    OR binding->'companyId' IS DISTINCT FROM to_jsonb(NEW.company_id::text)
    OR binding->'runId' IS DISTINCT FROM to_jsonb(NEW.id::text)
    OR binding->'agentId' IS DISTINCT FROM to_jsonb(NEW.agent_id::text)
    OR binding->'issueId' IS DISTINCT FROM coalesce(to_jsonb(NEW.native_issue_id::text),'null'::jsonb)
    OR jsonb_typeof(binding->'responsibleUserId') IS DISTINCT FROM 'string'
    OR length(binding->>'responsibleUserId')=0 THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Native run input receipt owner mismatch';
  END IF;
  IF receipt->'bootstrap'->>'executionInputDigest' IS DISTINCT FROM
      encode(sha256(convert_to((profile->'nativeExecutionInput')::text,'UTF8')),'hex') THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Native run bootstrap input digest mismatch';
  END IF;

  IF previous_receipt IS NULL THEN
    IF (coalesce(previous_profile ? 'nativeExecutionInput',false) AND NOT (
          TG_OP='UPDATE' AND OLD.native_input_source_protocol_version=0
          AND profile->'nativeExecutionInput' IS NOT DISTINCT FROM previous_profile->'nativeExecutionInput'
          AND jsonb_typeof(profile->'nativeModelInputDispatchIntents')='array'
          AND jsonb_array_length(profile->'nativeModelInputDispatchIntents')=1
          AND coalesce(profile->'nativeToolCallDispatchAssociations','[]'::jsonb)='[]'::jsonb
          AND coalesce(profile->'nativeToolResultSourceCaptures','[]'::jsonb)='[]'::jsonb
          AND public.aw_native_current_attachment_stage_matches(profile,NEW.company_id,NEW.id,NEW.agent_id,NEW.native_issue_id,NEW.responsible_user_id,receipt->'bootstrap'->'inputs',profile->'nativeModelInputDispatchIntents'->0)
          AND NEW.native_input_source_protocol_version=1
          AND NEW.runtime_mode='native' AND NEW.status='running'
        ))
      OR binding->>'responsibleUserId' IS DISTINCT FROM NEW.responsible_user_id
      OR jsonb_array_length(receipt->'dispatches')<>0 OR jsonb_array_length(receipt->'additionalInputs')<>0 THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Native run receipt must accompany its first input capture';
    END IF;
    IF TG_OP='UPDATE' AND coalesce(previous_profile ? 'nativeExecutionInput',false) THEN
      first_dispatch := profile->'nativeModelInputDispatchIntents'->0;
      IF jsonb_typeof(first_dispatch) IS DISTINCT FROM 'object'
        OR jsonb_typeof(first_dispatch->'dispatchId') IS DISTINCT FROM 'string'
        OR first_dispatch->>'dispatchId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        OR jsonb_typeof(first_dispatch->'turnInputDigest') IS DISTINCT FROM 'string'
        OR first_dispatch->>'turnInputDigest' !~ '^[0-9a-f]{64}$'
        OR first_dispatch->>'responsibleUserId' IS DISTINCT FROM NEW.responsible_user_id
        OR jsonb_typeof(first_dispatch->'eventSeq') IS DISTINCT FROM 'number'
        OR jsonb_typeof(first_dispatch->'attempt') IS DISTINCT FROM 'number'
        OR jsonb_typeof(first_dispatch->'turnId')='string'
        OR EXISTS(SELECT 1 FROM jsonb_array_elements(profile->'nativeModelInputDispatchIntents') AS intent(value)
          WHERE value ? 'turnId') THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Native first receipt requires one unacknowledged actual input intent';
      END IF;
    END IF;
  ELSE
    IF receipt-ARRAY['dispatches','additionalInputs','digest'] IS DISTINCT FROM
        previous_receipt-ARRAY['dispatches','additionalInputs','digest']
      OR profile->'nativeExecutionInput' IS DISTINCT FROM previous_profile->'nativeExecutionInput' THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Native run bootstrap capture is immutable';
    END IF;
  END IF;

  FOREACH family IN ARRAY ARRAY['bootstrap','dispatches','additionalInputs'] LOOP
    IF family='bootstrap' THEN
      allowed := ARRAY['executionInputDigest','policy','inputs'];
    ELSIF family='dispatches' THEN
      allowed := ARRAY['executionInputDigest','responsibleUserId','policy','inputs'];
    ELSE
      allowed := ARRAY['responsibleUserId','policy','inputs'];
    END IF;
    old_count := CASE WHEN family='bootstrap' OR previous_receipt IS NULL THEN 0
      ELSE jsonb_array_length(previous_receipt->family) END;
    IF family<>'bootstrap' AND jsonb_array_length(receipt->family)<old_count THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Native run input captures are append-only';
    END IF;
    capture_index := 0;
    FOR sources IN SELECT value FROM jsonb_array_elements(CASE WHEN family='bootstrap'
      THEN jsonb_build_array(receipt->family) ELSE receipt->family END) LOOP
      IF jsonb_typeof(sources) IS DISTINCT FROM 'object' OR NOT sources ?& allowed
        OR sources-allowed<>'{}'::jsonb OR jsonb_typeof(sources->'policy') IS DISTINCT FROM 'object'
        OR jsonb_typeof(sources->'inputs') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Malformed native run input capture';
      END IF;
      IF family<>'bootstrap' THEN
        IF capture_index<old_count THEN
          IF sources IS DISTINCT FROM previous_receipt->family->capture_index THEN
            RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Native run input captures are append-only';
          END IF;
        ELSIF jsonb_typeof(sources->'responsibleUserId') IS DISTINCT FROM 'string'
          OR length(sources->>'responsibleUserId')=0
          OR sources->>'responsibleUserId' IS DISTINCT FROM NEW.responsible_user_id THEN
          RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Native run input capture Human mismatch';
        END IF;
      END IF;
      IF family<>'additionalInputs' AND (jsonb_typeof(sources->'executionInputDigest') IS DISTINCT FROM 'string'
        OR sources->>'executionInputDigest' !~ '^[0-9a-f]{64}$') THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Malformed native input digest';
      END IF;
      IF family='dispatches' AND capture_index>=old_count THEN
        SELECT count(*) INTO matching_dispatches FROM jsonb_array_elements(profile->'nativeModelInputDispatchIntents') AS intent(value)
          WHERE value->>'turnInputDigest'=sources->>'executionInputDigest'
            AND value->>'responsibleUserId'=sources->>'responsibleUserId'
            AND jsonb_typeof(value->'turnId')='string'
            AND length(value->>'turnId')>0
            AND value->>'continuation'='false';
        IF matching_dispatches<>1 THEN
          RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Native dispatch source capture requires one exact acknowledged input';
        END IF;
      END IF;
      policy := sources->'policy';
      allowed := CASE WHEN family='bootstrap' THEN ARRAY['executionInputDigest','policy','inputs']
        WHEN family='dispatches' THEN ARRAY['executionInputDigest','responsibleUserId','policy','inputs']
        ELSE ARRAY['responsibleUserId','policy','inputs'] END;
      IF NOT policy ?& ARRAY['issueIds','projectIds','runIds','memoryIds','foundationRevisionIds']
        OR policy-ARRAY['issueIds','projectIds','runIds','memoryIds','foundationRevisionIds']<>'{}'::jsonb THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Malformed native input policy vectors';
      END IF;
      source_count := jsonb_array_length(sources->'inputs');
      FOREACH vector_name IN ARRAY ARRAY['issueIds','projectIds','runIds','memoryIds','foundationRevisionIds'] LOOP
        IF jsonb_typeof(policy->vector_name) IS DISTINCT FROM 'array' THEN
          RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Malformed native input policy vector';
        END IF;
        source_count := source_count + jsonb_array_length(policy->vector_name);
        IF (SELECT count(*)<>count(DISTINCT value) FROM jsonb_array_elements(policy->vector_name)) THEN
          RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Duplicate native input policy identity';
        END IF;
        FOR item IN SELECT value FROM jsonb_array_elements(policy->vector_name) LOOP
          IF jsonb_typeof(item) IS DISTINCT FROM 'string' OR item#>>'{}' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
            RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Malformed native input policy identity';
          END IF;
          captured_references := array_append(captured_references,vector_name || ':' || (item#>>'{}'));
        END LOOP;
      END LOOP;
      IF source_count>256 THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Native input capture exceeds source bounds';
      END IF;
      IF (SELECT count(*)<>count(DISTINCT value) FROM jsonb_array_elements(sources->'inputs')) THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Duplicate native captured input';
      END IF;
      FOR item IN SELECT value FROM jsonb_array_elements(sources->'inputs') LOOP
        -- Full finite input-family validation remains the shared parser's job.
        IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR jsonb_typeof(item->'kind') IS DISTINCT FROM 'string' THEN
          RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Malformed native captured input';
        END IF;
        captured_references := array_append(captured_references,'input:' || item::text);
      END LOOP;
      capture_index := capture_index+1;
    END LOOP;
  END LOOP;
  IF (SELECT count(DISTINCT value)>256 FROM unnest(captured_references) value) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Native run receipt exceeds distinct source bounds';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
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
        WHEN public.aw_native_durable_session_scope_only(
          jsonb_build_object('nativeDurableSessionScope', NEW.runner_profile_json->'nativeDurableSessionScope'))
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
