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
      AND (profile IS NULL OR profile='{}'::jsonb)
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
      (erased AND (profile IS NULL OR profile='{}'::jsonb)) THEN
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
    OR binding->'issueId' IS DISTINCT FROM coalesce(to_jsonb(NEW.issue_id::text),'null'::jsonb)
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
          AND coalesce(profile->'nativeAttachmentStageSources','[]'::jsonb)='[]'::jsonb
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
-- Protocol writer capability may be admitted only at the first exact native
-- controller frame, in the same UPDATE that installs its receipt and intent.
-- It remains distinct from source qualification or provider consumption.
CREATE OR REPLACE FUNCTION public.aw_native_input_source_protocol_binding() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  intents jsonb;
  first_intent jsonb;
BEGIN
  IF TG_OP='UPDATE' AND NEW.native_input_source_protocol_version IS DISTINCT FROM OLD.native_input_source_protocol_version THEN
    intents := NEW.runner_profile_json->'nativeModelInputDispatchIntents';
    IF OLD.native_input_source_protocol_version<>0 OR NEW.native_input_source_protocol_version<>1
      OR OLD.runtime_mode<>'native' OR NEW.runtime_mode<>'native'
      OR OLD.status<>'running' OR NEW.status<>'running'
      OR NOT (OLD.runner_profile_json ? 'nativeExecutionInput')
      OR NEW.runner_profile_json->'nativeExecutionInput' IS DISTINCT FROM OLD.runner_profile_json->'nativeExecutionInput'
      OR OLD.runner_profile_json ? 'nativeModelInputDispatchIntents'
      OR OLD.runner_profile_json ? 'nativeToolCallDispatchAssociations'
      OR OLD.runner_profile_json ? 'nativeToolResultSourceCaptures'
      OR OLD.runner_profile_json ? 'nativeAttachmentStageSources'
      OR NOT (NEW.runner_profile_json ? 'nativeInputSourceReceipt')
      OR jsonb_typeof(intents) IS DISTINCT FROM 'array' OR jsonb_array_length(intents)<>1
      OR NEW.trigger_detail IN ('provider_conformance','agent_safe_test') THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Native input source protocol requires the first actual native frame receipt';
    END IF;
    first_intent := intents->0;
    IF jsonb_typeof(first_intent) IS DISTINCT FROM 'object'
      OR first_intent ? 'turnId'
      OR first_intent->>'responsibleUserId' IS DISTINCT FROM NEW.responsible_user_id THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Native input source protocol requires an unacknowledged current Human intent';
    END IF;
  END IF;
  IF NEW.native_input_source_protocol_version=1 AND NEW.trigger_detail IN ('provider_conformance','agent_safe_test') THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Synthetic probes cannot claim native input source protocol';
  END IF;
  RETURN NEW;
END;
$$;
