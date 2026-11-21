CREATE OR REPLACE FUNCTION public.aw_native_canonical_jsonb(value jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, public AS $$
DECLARE
  result text;
  first_value boolean;
  key text;
  child jsonb;
BEGIN
  CASE jsonb_typeof(value)
    WHEN 'object' THEN
      result := '{'; first_value := true;
      FOR key, child IN SELECT entry.key, entry.value FROM jsonb_each(value) entry ORDER BY entry.key LOOP
        IF NOT first_value THEN result := result || ','; END IF;
        result := result || to_json(key)::text || ':' || public.aw_native_canonical_jsonb(child);
        first_value := false;
      END LOOP;
      RETURN result || '}';
    WHEN 'array' THEN
      result := '['; first_value := true;
      FOR child IN SELECT entry.value FROM jsonb_array_elements(value) WITH ORDINALITY entry(value,ordinality) ORDER BY entry.ordinality LOOP
        IF NOT first_value THEN result := result || ','; END IF;
        result := result || public.aw_native_canonical_jsonb(child);
        first_value := false;
      END LOOP;
      RETURN result || ']';
    ELSE
      RETURN value::text;
  END CASE;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.aw_native_current_attachment_stage_matches(
  p_profile jsonb, p_company_id uuid, p_run_id uuid, p_agent_id uuid, p_issue_id uuid, p_responsible_user text,
  p_bootstrap_inputs jsonb, p_dispatch_intent jsonb
) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE
  stages jsonb;
  stage jsonb;
  captures jsonb;
  attachment_inputs jsonb;
  capture_inputs jsonb;
  input_row jsonb;
  capture_row jsonb;
  source_snapshot jsonb;
  authority jsonb;
  expected_stage_hash text;
  stage_hash text;
BEGIN
  IF jsonb_typeof(p_profile) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_profile->'nativeExecutionInput') IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_profile->'nativeExecutionInput'->'binding') IS DISTINCT FROM 'object'
    OR p_profile->'nativeExecutionInput'->'binding'->>'companyId' IS DISTINCT FROM p_company_id::text
    OR p_profile->'nativeExecutionInput'->'binding'->>'runId' IS DISTINCT FROM p_run_id::text
    OR p_profile->'nativeExecutionInput'->'binding'->>'agentId' IS DISTINCT FROM p_agent_id::text
    OR p_profile->'nativeExecutionInput'->'binding'->>'issueId' IS DISTINCT FROM p_issue_id::text
    OR jsonb_typeof(p_bootstrap_inputs) IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_dispatch_intent) IS DISTINCT FROM 'object' THEN
    RETURN false;
  END IF;
  SELECT coalesce(jsonb_agg(item.value ORDER BY item.ordinality), '[]'::jsonb) INTO attachment_inputs
    FROM jsonb_array_elements(p_bootstrap_inputs) WITH ORDINALITY item(value,ordinality)
    WHERE item.value->>'kind'='attachment';
  stages := p_profile->'nativeAttachmentStageSources';
  IF stages IS NULL THEN RETURN jsonb_array_length(attachment_inputs)=0; END IF;
  IF jsonb_typeof(stages) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(stages)=0 THEN RETURN jsonb_array_length(attachment_inputs)=0; END IF;
  IF jsonb_array_length(stages)<>1 OR jsonb_array_length(attachment_inputs)=0 THEN RETURN false; END IF;
  stage := stages->0;
  IF jsonb_typeof(stage) IS DISTINCT FROM 'object'
    OR NOT stage ?& ARRAY['eventSeq','attempt','responsibleUserId','baseTaskDigest','finalTaskDigest','sourceCaptureHash','descriptorHash','stageHash','sourceCaptures']
    OR stage-ARRAY['eventSeq','attempt','responsibleUserId','baseTaskDigest','finalTaskDigest','sourceCaptureHash','descriptorHash','stageHash','sourceCaptures']<>'{}'::jsonb
    OR jsonb_typeof(stage->'eventSeq') IS DISTINCT FROM 'number'
    OR jsonb_typeof(stage->'attempt') IS DISTINCT FROM 'number'
    OR stage->>'eventSeq' !~ '^[1-9][0-9]{0,9}$'
    OR stage->>'attempt' !~ '^[1-9][0-9]{0,9}$'
    OR (stage->>'eventSeq')::numeric>2147483647
    OR (stage->>'attempt')::numeric>2147483647
    OR stage->'eventSeq' IS DISTINCT FROM p_dispatch_intent->'eventSeq'
    OR stage->'attempt' IS DISTINCT FROM p_dispatch_intent->'attempt'
    OR stage->'responsibleUserId' IS DISTINCT FROM coalesce(to_jsonb(p_responsible_user),'null'::jsonb)
    OR p_dispatch_intent->>'responsibleUserId' IS DISTINCT FROM p_responsible_user
    OR jsonb_typeof(stage->'baseTaskDigest') IS DISTINCT FROM 'string'
    OR stage->>'baseTaskDigest' !~ '^[0-9a-f]{64}$'
    OR stage->>'baseTaskDigest' IS DISTINCT FROM encode(sha256(convert_to(public.aw_native_canonical_jsonb(p_profile->'nativeExecutionInput'->'task'),'UTF8')),'hex')
    OR jsonb_typeof(stage->'finalTaskDigest') IS DISTINCT FROM 'string'
    OR stage->>'finalTaskDigest' !~ '^[0-9a-f]{64}$'
    OR jsonb_typeof(stage->'sourceCaptureHash') IS DISTINCT FROM 'string'
    OR stage->>'sourceCaptureHash' !~ '^[0-9a-f]{64}$'
    OR jsonb_typeof(stage->'descriptorHash') IS DISTINCT FROM 'string'
    OR stage->>'descriptorHash' !~ '^[0-9a-f]{64}$'
    OR jsonb_typeof(stage->'stageHash') IS DISTINCT FROM 'string'
    OR stage->>'stageHash' !~ '^[0-9a-f]{64}$'
    OR jsonb_typeof(stage->'sourceCaptures') IS DISTINCT FROM 'array'
    OR jsonb_array_length(stage->'sourceCaptures') NOT BETWEEN 1 AND 64 THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.heartbeat_run_events event
      WHERE event.company_id=p_company_id AND event.run_id=p_run_id AND event.agent_id=p_agent_id
        AND event.seq=(stage->>'eventSeq')::integer AND event.event_type='native.process_start_requested')
    OR NOT EXISTS (SELECT 1 FROM public.native_run_finalizations finalization
      WHERE finalization.company_id=p_company_id AND finalization.run_id=p_run_id
        AND finalization.attempt=(stage->>'attempt')::integer AND finalization.lease_expires_at>clock_timestamp()) THEN
    RETURN false;
  END IF;
  captures := stage->'sourceCaptures';
  SELECT coalesce(jsonb_agg(capture.value->'input' ORDER BY capture.ordinality), '[]'::jsonb) INTO capture_inputs
    FROM jsonb_array_elements(captures) WITH ORDINALITY capture(value,ordinality);
  IF capture_inputs IS DISTINCT FROM attachment_inputs THEN RETURN false; END IF;
  FOR capture_row IN SELECT value FROM jsonb_array_elements(captures) LOOP
    input_row := capture_row->'input';
    source_snapshot := capture_row->'payloadSourceSnapshot';
    IF jsonb_typeof(capture_row) IS DISTINCT FROM 'object'
      OR capture_row-ARRAY['input','payloadSourceSnapshot']<>'{}'::jsonb
      OR jsonb_typeof(input_row) IS DISTINCT FROM 'object'
      OR NOT input_row ?& ARRAY['kind','issueId','attachmentId','commentId','assetId','sha256','byteSize','disposition']
      OR input_row-ARRAY['kind','issueId','attachmentId','commentId','assetId','sha256','byteSize','disposition']<>'{}'::jsonb
      OR input_row->>'kind' IS DISTINCT FROM 'attachment'
      OR input_row->>'issueId' IS DISTINCT FROM p_issue_id::text
      OR jsonb_typeof(input_row->'attachmentId') IS DISTINCT FROM 'string'
      OR input_row->>'attachmentId' !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
      OR jsonb_typeof(input_row->'commentId') NOT IN ('string','null')
      OR (input_row->>'commentId' IS NOT NULL AND input_row->>'commentId' !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$')
      OR jsonb_typeof(input_row->'assetId') IS DISTINCT FROM 'string'
      OR input_row->>'assetId' !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
      OR jsonb_typeof(input_row->'sha256') IS DISTINCT FROM 'string'
      OR input_row->>'sha256' !~ '^[0-9a-f]{64}$'
      OR jsonb_typeof(input_row->'byteSize') IS DISTINCT FROM 'number'
      OR (input_row->>'byteSize')::numeric<0 OR (input_row->>'byteSize')::numeric>2147483647
      OR input_row->>'disposition' IS DISTINCT FROM 'delivered'
      OR jsonb_typeof(source_snapshot) IS DISTINCT FROM 'object'
      OR source_snapshot->'version' IS DISTINCT FROM '1'::jsonb
      OR source_snapshot->'owner'->>'kind' IS DISTINCT FROM 'attachment'
      OR source_snapshot->'owner'->>'companyId' IS DISTINCT FROM p_company_id::text
      OR source_snapshot->'owner'->>'id' IS DISTINCT FROM input_row->>'attachmentId'
      OR source_snapshot->>'digest' IS DISTINCT FROM encode(sha256(convert_to((source_snapshot-'digest')::text,'UTF8')),'hex')
      OR NOT EXISTS (SELECT 1 FROM public.issue_attachments attachment
        JOIN public.assets asset ON asset.company_id=attachment.company_id AND asset.id=attachment.asset_id
        WHERE attachment.company_id=p_company_id AND attachment.issue_id=p_issue_id
          AND attachment.id=(input_row->>'attachmentId')::uuid
          AND attachment.issue_comment_id IS NOT DISTINCT FROM nullif(input_row->>'commentId','')::uuid
          AND attachment.asset_id=(input_row->>'assetId')::uuid
          AND attachment.payload_source_protocol_version=1 AND NOT attachment.payload_source_snapshot_invalidated
          AND attachment.payload_source_snapshot=source_snapshot
          AND asset.sha256=input_row->>'sha256' AND asset.byte_size=(input_row->>'byteSize')::integer) THEN
      RETURN false;
    END IF;
  END LOOP;
  IF stage->>'sourceCaptureHash' IS DISTINCT FROM encode(sha256(convert_to(public.aw_native_canonical_jsonb(captures),'UTF8')),'hex') THEN
    RETURN false;
  END IF;
  stage_hash := encode(sha256(convert_to(public.aw_native_canonical_jsonb(jsonb_build_object(
    'eventSeq',stage->'eventSeq','attempt',stage->'attempt','responsibleUserId',stage->'responsibleUserId',
    'baseTaskDigest',stage->'baseTaskDigest','finalTaskDigest',stage->'finalTaskDigest',
    'sourceCaptureHash',stage->'sourceCaptureHash','descriptorHash',stage->'descriptorHash')),'UTF8')),'hex');
  IF stage_hash IS DISTINCT FROM stage->>'stageHash' THEN RETURN false; END IF;
  authority := p_profile->'nativeOpenCodeSourceAuthority';
  IF jsonb_typeof(authority)='object' AND authority->'version'='1'::jsonb
    AND (authority->>'executionInputHash' IS DISTINCT FROM encode(sha256(convert_to(public.aw_native_canonical_jsonb(p_profile->'nativeExecutionInput'),'UTF8')),'hex')
      OR authority->>'attachmentStageHash' IS DISTINCT FROM stage->>'stageHash') THEN
    RETURN false;
  END IF;
  RETURN true;
EXCEPTION WHEN others THEN
  RETURN false;
END;
$$;
--> statement-breakpoint
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
      OR ((OLD.runner_profile_json ? 'nativeAttachmentStageSources') AND NOT public.aw_native_current_attachment_stage_matches(NEW.runner_profile_json,NEW.company_id,NEW.id,NEW.agent_id,NEW.native_issue_id,NEW.responsible_user_id,NEW.runner_profile_json->'nativeInputSourceReceipt'->'bootstrap'->'inputs',intents->0))
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
