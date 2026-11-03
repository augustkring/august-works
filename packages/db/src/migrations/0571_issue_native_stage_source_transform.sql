-- A workspace is realized before Native runtime selection. This shared locking
-- proof admits only the current bootstrap controller's metadata binding; both
-- the service and the existing source trigger use this exact owner predicate.
CREATE FUNCTION public.aw_workspace_preparation_binding_owned(
  p_company_id uuid, p_issue_id uuid, p_agent_id uuid, p_run_id uuid, p_workspace_id uuid, p_controller_boot_id uuid
) RETURNS boolean LANGUAGE plpgsql STRICT SET search_path=pg_catalog,public AS $$
DECLARE owned_count integer;
BEGIN
  PERFORM 1 FROM public.heartbeat_runs r
    JOIN public.agents a ON a.company_id=r.company_id AND a.id=r.agent_id AND a.adapter_type='paperclip_runner'
    JOIN public.issues i ON i.company_id=r.company_id AND i.id=p_issue_id AND i.execution_run_id=r.id
    JOIN public.execution_workspaces w ON w.company_id=r.company_id AND w.id=p_workspace_id AND w.status='active'
    JOIN public.environment_leases l ON l.company_id=r.company_id AND l.issue_id=i.id AND l.heartbeat_run_id=r.id
      AND l.execution_workspace_id=w.id AND l.status='active' AND (l.expires_at IS NULL OR l.expires_at>clock_timestamp())
    WHERE r.company_id=p_company_id AND r.id=p_run_id AND r.agent_id=p_agent_id AND r.issue_id=i.id
      AND r.scope_kind='issue' AND i.assignee_agent_id=r.agent_id AND i.hidden_at IS NULL
      AND i.status NOT IN ('done','cancelled') AND r.status='running' AND r.runtime_mode='legacy' AND r.execution_stage='preparing'
      AND r.controller_boot_id=p_controller_boot_id AND r.controller_lease_expires_at>clock_timestamp()
      AND r.runtime_mode_resolved_at IS NULL AND (r.native_issue_id IS NULL OR r.native_issue_id=i.id) AND r.native_phase IS NULL
      AND jsonb_typeof(r.context_snapshot)='object'
      AND coalesce(r.context_snapshot->>'issueId',r.context_snapshot->>'taskId')=i.id::text
      AND (r.context_snapshot->>'issueId' IS NULL OR r.context_snapshot->>'issueId'=i.id::text)
      AND (r.context_snapshot->>'taskId' IS NULL OR r.context_snapshot->>'taskId'=i.id::text)
      AND r.native_session_id IS NULL AND r.runner_instance_id IS NULL AND r.next_event_seq=1
      AND r.native_input_source_protocol_version=0 AND r.process_pid IS NULL AND r.process_group_id IS NULL
      AND r.responsible_user_id IS NOT NULL AND r.responsible_user_id=i.responsible_user_id
      AND r.runner_profile_json->'adapterDispatch'->>'adapterType'='paperclip_runner'
      AND NOT (coalesce(r.runner_profile_json,'{}'::jsonb) ?| ARRAY['nativeExecutionInput','nativeInputSourceReceipt',
        'nativeModelInputDispatchIntents','nativeToolCallDispatchAssociations','nativeToolResultSourceCaptures'])
      AND NOT (coalesce(r.result_json,'{}'::jsonb) ?| ARRAY['nativeResult','nativeStagePolicyTransitions',
        'nativeStageTaskBodyTransitions','apiToolReceipts','startupCancellation'])
      AND r.result_json->'executionCancellation'->>'state' IS DISTINCT FROM 'requested'
      AND NOT EXISTS (SELECT 1 FROM public.native_run_finalizations f WHERE f.company_id=r.company_id AND f.run_id=r.id)
      AND NOT EXISTS (SELECT 1 FROM public.native_run_results n WHERE n.company_id=r.company_id AND n.run_id=r.id)
    FOR SHARE OF r,a,i,w,l;
  GET DIAGNOSTICS owned_count=ROW_COUNT;
  RETURN owned_count=1;
END;
$$;
--> statement-breakpoint
-- Extend the existing 0570 trigger function without changing published migration bytes.
-- A manual related Task's literal Human text remains the same source input when
-- Native binds its execution workspace. Record that narrowly bounded owner
-- transition; never let a generic UPDATE restamp or discard its source history.
CREATE OR REPLACE FUNCTION public.aw_issue_workspace_source_transform() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE old_transforms jsonb; new_transforms jsonb; step jsonb; n integer; i integer;
  expected_tuple_hash text; old_settings_hash text; new_settings_hash text;
  expected_mode text; run_agent uuid; activity_details jsonb; step_key_count integer;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.payload_source_snapshot ? 'transforms' THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Workspace source transforms require a prior manual Task snapshot';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.payload_source_snapshot IS NULL OR OLD.payload_source_snapshot IS NULL THEN
    RETURN NEW;
  END IF;
  old_transforms := coalesce(OLD.payload_source_snapshot->'transforms','[]'::jsonb);
  new_transforms := coalesce(NEW.payload_source_snapshot->'transforms','[]'::jsonb);
  IF old_transforms IS NOT DISTINCT FROM new_transforms THEN
    IF NEW.payload_source_snapshot ? 'transforms' AND jsonb_array_length(new_transforms)=0 THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Empty workspace source transform history is not canonical';
    END IF;
    RETURN NEW;
  END IF;
  -- Distinct Native machine-policy owner. The actual Native decision/effect
  -- is checked by the deferred trigger after the same transaction materializes
  -- it. The before trigger enforces the exact one-update source/body binding.
  IF jsonb_typeof(new_transforms)='array' AND jsonb_array_length(new_transforms)>0 AND
     new_transforms->(jsonb_array_length(new_transforms)-1)->>'kind'='native_stage_policy' THEN
    n:=jsonb_array_length(old_transforms);
    step:=new_transforms->n;
    IF OLD.payload_source_protocol_version<>1 OR OLD.payload_source_snapshot_invalidated OR
       NEW.payload_source_snapshot_invalidated OR OLD.conversation_agent_id IS NOT NULL OR
       jsonb_array_length(new_transforms)<>n+1 OR n>=32 OR
       OLD.payload_source_snapshot->'policy' IS DISTINCT FROM NEW.payload_source_snapshot->'policy' OR
       OLD.payload_source_snapshot->'inputs' IS DISTINCT FROM NEW.payload_source_snapshot->'inputs' OR
       OLD.payload_source_snapshot->>'digest' IS DISTINCT FROM step->>'previousSnapshotDigest' OR
       OLD.payload_source_snapshot->'owner'->>'contentHash' IS DISTINCT FROM step->>'previousOwnerContentHash' OR
       NEW.payload_source_snapshot->'owner'->>'contentHash' IS DISTINCT FROM step->>'nextOwnerContentHash' OR
       public.aw_native_payload_body_hash('issue',to_jsonb(OLD)) IS DISTINCT FROM step->>'previousOwnerContentHash' OR
       public.aw_native_payload_body_hash('issue',to_jsonb(NEW)) IS DISTINCT FROM step->>'nextOwnerContentHash' OR
       public.aw_native_payload_body_hash('issue',to_jsonb(NEW) || jsonb_build_object(
         'execution_state',OLD.execution_state,'unblock_descriptor',OLD.unblock_descriptor)) IS DISTINCT FROM
         public.aw_native_payload_body_hash('issue',to_jsonb(OLD)) OR
       OLD.payload_source_snapshot->>'digest' IS DISTINCT FROM encode(sha256(convert_to((OLD.payload_source_snapshot-'digest')::text,'UTF8')),'hex') OR
       NEW.payload_source_snapshot->>'digest' IS DISTINCT FROM encode(sha256(convert_to((NEW.payload_source_snapshot-'digest')::text,'UTF8')),'hex') THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Native Stage source must preserve its original literal and source closure';
    END IF;
    IF n>0 THEN FOR i IN 0..n-1 LOOP
      IF old_transforms->i IS DISTINCT FROM new_transforms->i THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Native Stage source history is append-only';
      END IF;
    END LOOP; END IF;
    SELECT count(*) INTO step_key_count FROM jsonb_object_keys(step);
    IF step_key_count<>9 OR NOT (step ?& ARRAY['kind','transitionId','runId','ownerKind','decisionId',
       'receiptHash','previousSnapshotDigest','previousOwnerContentHash','nextOwnerContentHash']) OR
       step->>'ownerKind' NOT IN ('native_status_decision','native_stage_comment') THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Native Stage source transform has unknown fields';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.payload_source_protocol_version<>1 OR OLD.payload_source_snapshot_invalidated OR
     NEW.payload_source_snapshot_invalidated OR OLD.origin_kind<>'manual' OR OLD.created_by_user_id IS NULL OR
     OLD.created_by_agent_id IS NOT NULL OR OLD.conversation_agent_id IS NOT NULL OR
     (OLD.parent_id IS NULL AND OLD.project_id IS NULL) OR
     jsonb_typeof(old_transforms)<>'array' OR jsonb_typeof(new_transforms)<>'array' THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Workspace source transform owner is not a retained manual related Task';
  END IF;
  n := jsonb_array_length(old_transforms);
  IF jsonb_array_length(new_transforms)<>n+1 OR
     (OLD.payload_source_snapshot->'policy') IS DISTINCT FROM (NEW.payload_source_snapshot->'policy') OR
     (OLD.payload_source_snapshot->'inputs') IS DISTINCT FROM (NEW.payload_source_snapshot->'inputs') OR
     OLD.payload_source_snapshot->'owner'->>'contentHash' IS DISTINCT FROM
       NEW.payload_source_snapshot->'transforms'->(n)->>'previousOwnerContentHash' OR
     OLD.payload_source_snapshot->>'digest' IS DISTINCT FROM
       NEW.payload_source_snapshot->'transforms'->(n)->>'previousSnapshotDigest' OR
     (to_jsonb(NEW)-ARRAY['payload_source_snapshot','updated_at','execution_workspace_id','project_workspace_id',
       'execution_workspace_preference','execution_workspace_settings']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['payload_source_snapshot','updated_at','execution_workspace_id','project_workspace_id',
       'execution_workspace_preference','execution_workspace_settings']) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Workspace source transform must append one exact Task binding transition';
  END IF;
  IF n>0 THEN
    FOR i IN 0..n-1 LOOP
      IF new_transforms->i IS DISTINCT FROM old_transforms->i THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Workspace source transform history is append-only';
      END IF;
    END LOOP;
  END IF;
  step := new_transforms->n;
  IF n=0 AND (
      OLD.payload_source_snapshot->'inputs' IS DISTINCT FROM '[]'::jsonb OR
      OLD.payload_source_snapshot->'policy' IS DISTINCT FROM jsonb_build_object(
        'issueIds',CASE WHEN OLD.parent_id IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(OLD.parent_id::text) END,
        'projectIds',CASE WHEN OLD.project_id IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(OLD.project_id::text) END,
        'runIds','[]'::jsonb,'memoryIds','[]'::jsonb,'foundationRevisionIds','[]'::jsonb) OR
      NOT EXISTS (SELECT 1 FROM public.activity_log a WHERE a.company_id=OLD.company_id
        AND a.entity_type='issue' AND a.entity_id=OLD.id::text AND a.action='issue.payload_source_captured'
        AND a.actor_type='user' AND a.actor_id=OLD.created_by_user_id
        AND a.details->>'producer'='direct_manual_related_input'
        AND (a.details->>'parentId') IS NOT DISTINCT FROM OLD.parent_id::text
        AND (a.details->>'projectId') IS NOT DISTINCT FROM OLD.project_id::text
        AND (NOT (a.details ? 'projectWorkspaceId') OR
          (a.details->>'projectWorkspaceId') IS NOT DISTINCT FROM OLD.project_workspace_id::text)
        AND a.details->>'digest'=OLD.payload_source_snapshot->>'digest'
        AND a.details->>'contentHash'=OLD.payload_source_snapshot->'owner'->>'contentHash')) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Workspace source transform lacks its original Human capture';
  END IF;
  IF jsonb_typeof(step) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Workspace source transform is not an object';
  END IF;
  SELECT count(*) INTO step_key_count FROM jsonb_object_keys(step);
  IF step_key_count<>17 OR NOT (step ?& ARRAY[
       'kind','activityId','transitionId','runId','workspaceId','workspaceTupleHash',
       'beforeProjectWorkspaceId','afterProjectWorkspaceId','previousSnapshotDigest',
       'previousOwnerContentHash','nextOwnerContentHash','beforePreference','beforeMode',
       'beforeSettingsHash','afterPreference','afterMode','afterSettingsHash']) OR
     step->>'kind' IS DISTINCT FROM 'workspace_binding' OR
     step->>'beforeProjectWorkspaceId' IS DISTINCT FROM OLD.project_workspace_id::text OR
     step->>'afterProjectWorkspaceId' IS DISTINCT FROM NEW.project_workspace_id::text OR
     step->>'previousOwnerContentHash' IS DISTINCT FROM OLD.payload_source_snapshot->'owner'->>'contentHash' OR
     step->>'nextOwnerContentHash' IS DISTINCT FROM NEW.payload_source_snapshot->'owner'->>'contentHash' OR
     step->>'previousSnapshotDigest' IS DISTINCT FROM OLD.payload_source_snapshot->>'digest' OR
     step->>'afterPreference' IS DISTINCT FROM NEW.execution_workspace_preference OR
     step->>'beforePreference' IS DISTINCT FROM OLD.execution_workspace_preference OR
     step->>'beforeMode' IS DISTINCT FROM OLD.execution_workspace_settings->>'mode' OR
     step->>'afterMode' IS DISTINCT FROM NEW.execution_workspace_settings->>'mode' OR
     step->>'workspaceId' IS DISTINCT FROM NEW.execution_workspace_id::text OR
     NEW.execution_workspace_preference IS NOT DISTINCT FROM OLD.execution_workspace_preference AND
       NEW.execution_workspace_settings IS NOT DISTINCT FROM OLD.execution_workspace_settings AND
       NEW.project_workspace_id IS NOT DISTINCT FROM OLD.project_workspace_id OR
     (coalesce(NEW.execution_workspace_settings,'{}'::jsonb)-'mode') IS DISTINCT FROM
       (coalesce(OLD.execution_workspace_settings,'{}'::jsonb)-'mode') THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Workspace source transform does not match the Task binding transition';
  END IF;
  IF NEW.payload_source_snapshot->>'digest' IS DISTINCT FROM
      encode(sha256(convert_to((NEW.payload_source_snapshot-'digest')::text,'UTF8')),'hex') OR
     OLD.payload_source_snapshot->>'digest' IS DISTINCT FROM
      encode(sha256(convert_to((OLD.payload_source_snapshot-'digest')::text,'UTF8')),'hex') THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Workspace source transform has an invalid snapshot digest';
  END IF;
  SELECT encode(sha256(convert_to(jsonb_build_object('id',w.id,'companyId',w.company_id,'projectId',w.project_id,
      'projectWorkspaceId',w.project_workspace_id,'mode',w.mode,'cwd',w.cwd,'repoUrl',w.repo_url,
      'baseRef',w.base_ref,'branchName',w.branch_name,'providerType',w.provider_type,'providerRef',w.provider_ref)::text,'UTF8')),'hex'),
      CASE WHEN w.mode IN ('shared_workspace','isolated_workspace','operator_branch') THEN w.mode
        WHEN w.mode IS NULL OR w.mode IN ('adapter_managed','cloud_sandbox') THEN 'agent_default' ELSE 'shared_workspace' END
    INTO expected_tuple_hash, expected_mode
    FROM public.execution_workspaces w
    WHERE w.company_id=NEW.company_id AND w.id=NEW.execution_workspace_id AND w.status='active';
  IF expected_tuple_hash IS NULL OR step->>'workspaceTupleHash' IS DISTINCT FROM expected_tuple_hash OR
     step->>'afterMode' IS DISTINCT FROM expected_mode THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Workspace source transform is not bound to the current persisted workspace';
  END IF;
  old_settings_hash := encode(sha256(convert_to(coalesce(OLD.execution_workspace_settings,'null'::jsonb)::text,'UTF8')),'hex');
  new_settings_hash := encode(sha256(convert_to(coalesce(NEW.execution_workspace_settings,'null'::jsonb)::text,'UTF8')),'hex');
  IF step->>'beforeSettingsHash' IS DISTINCT FROM old_settings_hash OR
     step->>'afterSettingsHash' IS DISTINCT FROM new_settings_hash THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Workspace source transform settings receipt is stale';
  END IF;
  SELECT r.agent_id INTO run_agent FROM public.heartbeat_runs r
    WHERE r.company_id=NEW.company_id AND r.id=(step->>'runId')::uuid AND r.status='running'
      AND (coalesce(r.native_issue_id,r.issue_id)=NEW.id) AND (
        r.runtime_mode='native' OR public.aw_workspace_preparation_binding_owned(
          NEW.company_id,NEW.id,r.agent_id,r.id,NEW.execution_workspace_id,
          nullif(current_setting('paperclip.workspace_preparation_controller_boot_id',true),'')::uuid)
      );
  IF run_agent IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.environment_leases l
      WHERE l.company_id=NEW.company_id AND l.issue_id=NEW.id AND l.heartbeat_run_id=(step->>'runId')::uuid
        AND l.execution_workspace_id=NEW.execution_workspace_id AND l.status='active'
        AND (l.expires_at IS NULL OR l.expires_at>clock_timestamp())
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Workspace source transform requires its live Native Run and lease';
  END IF;
  SELECT a.details INTO activity_details FROM public.activity_log a
    WHERE a.company_id=NEW.company_id AND a.id=(step->>'activityId')::uuid
      AND a.actor_type='agent' AND a.actor_id=run_agent::text AND a.agent_id=run_agent
      AND a.run_id=(step->>'runId')::uuid AND a.action='issue.payload_source_workspace_bound'
      AND a.entity_type='issue' AND a.entity_id=NEW.id::text;
  IF activity_details IS NULL OR
     activity_details->>'kind' IS DISTINCT FROM step->>'kind' OR
     activity_details->>'transitionId' IS DISTINCT FROM step->>'transitionId' OR
     activity_details->>'workspaceId' IS DISTINCT FROM step->>'workspaceId' OR
     activity_details->>'workspaceTupleHash' IS DISTINCT FROM step->>'workspaceTupleHash' OR
     activity_details->>'beforeProjectWorkspaceId' IS DISTINCT FROM step->>'beforeProjectWorkspaceId' OR
     activity_details->>'afterProjectWorkspaceId' IS DISTINCT FROM step->>'afterProjectWorkspaceId' OR
     activity_details->>'previousSnapshotDigest' IS DISTINCT FROM step->>'previousSnapshotDigest' OR
     activity_details->>'previousOwnerContentHash' IS DISTINCT FROM step->>'previousOwnerContentHash' OR
     activity_details->>'nextOwnerContentHash' IS DISTINCT FROM step->>'nextOwnerContentHash' OR
     activity_details->>'beforePreference' IS DISTINCT FROM step->>'beforePreference' OR
     activity_details->>'beforeMode' IS DISTINCT FROM step->>'beforeMode' OR
     activity_details->>'beforeSettingsHash' IS DISTINCT FROM step->>'beforeSettingsHash' OR
     activity_details->>'afterPreference' IS DISTINCT FROM step->>'afterPreference' OR
     activity_details->>'afterMode' IS DISTINCT FROM step->>'afterMode' OR
     activity_details->>'afterSettingsHash' IS DISTINCT FROM step->>'afterSettingsHash' THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Workspace source transform activity receipt is missing or mismatched';
  END IF;
  RETURN NEW;
END;
$$;

--> statement-breakpoint
-- Policy metadata may change without discarding its original Human/model
-- sources. Validate the real owner at transaction end: the status committer
-- creates its Stage outbox effect AFTER the single coherent Task UPDATE.
CREATE FUNCTION public.aw_issue_native_stage_source_owner() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE old_steps jsonb; new_steps jsonb; step jsonb; receipt jsonb; producer public.heartbeat_runs%ROWTYPE;
  n integer; receipt_key text;
BEGIN
  old_steps:=coalesce(OLD.payload_source_snapshot->'transforms','[]'::jsonb);
  new_steps:=coalesce(NEW.payload_source_snapshot->'transforms','[]'::jsonb);
  IF old_steps IS NOT DISTINCT FROM new_steps OR NEW.payload_source_snapshot IS NULL THEN RETURN NULL; END IF;
  n:=jsonb_array_length(old_steps);
  step:=new_steps->n;
  IF step->>'kind' IS DISTINCT FROM 'native_stage_policy' THEN RETURN NULL; END IF;
  SELECT * INTO producer FROM public.heartbeat_runs r WHERE r.id=(step->>'runId')::uuid AND
    r.company_id=NEW.company_id AND r.native_issue_id=NEW.id AND r.runtime_mode='native';
  receipt:=producer.result_json->'nativeStageTaskBodyTransitions'->(step->>'transitionId');
  IF producer.id IS NULL OR producer.responsible_user_id IS NULL OR receipt IS NULL OR
    CASE WHEN jsonb_typeof(receipt)='object' THEN (SELECT count(*) FROM jsonb_object_keys(receipt)) ELSE -1 END<>20 OR
    NOT (receipt ?& ARRAY['version','companyId','issueId','runId','agentId','responsibleUserId',
      'transitionId','owner','originalInputReceiptDigest','originalDispatchCount','originalAdditionalInputCount','executionInputDigest',
      'originalSnapshot','previousOwnerContentHash','nextOwnerContentHash','fromExecutionState','toExecutionState',
      'fromUnblockDescriptor','toUnblockDescriptor','ownerFingerprint']) OR
    jsonb_typeof(receipt->'originalDispatchCount') IS DISTINCT FROM 'number' OR
    jsonb_typeof(receipt->'originalAdditionalInputCount') IS DISTINCT FROM 'number' OR
    CASE WHEN (receipt->>'originalDispatchCount') ~ '^(0|[1-9][0-9]{0,2})$'
      THEN (receipt->>'originalDispatchCount')::integer ELSE -1 END NOT BETWEEN 0 AND 64 OR
    CASE WHEN (receipt->>'originalAdditionalInputCount') ~ '^(0|[1-9][0-9]{0,2})$'
      THEN (receipt->>'originalAdditionalInputCount')::integer ELSE -1 END NOT BETWEEN 0 AND 256 OR
    CASE WHEN jsonb_typeof(producer.runner_profile_json->'nativeInputSourceReceipt'->'dispatches')='array'
      THEN jsonb_array_length(producer.runner_profile_json->'nativeInputSourceReceipt'->'dispatches') ELSE -1 END < 0 OR
    CASE WHEN jsonb_typeof(producer.runner_profile_json->'nativeInputSourceReceipt'->'additionalInputs')='array'
      THEN jsonb_array_length(producer.runner_profile_json->'nativeInputSourceReceipt'->'additionalInputs') ELSE -1 END < 0 OR
    CASE WHEN (receipt->>'originalDispatchCount') ~ '^(0|[1-9][0-9]{0,2})$'
      THEN (receipt->>'originalDispatchCount')::integer ELSE -1 END IS DISTINCT FROM
      CASE WHEN jsonb_typeof(producer.runner_profile_json->'nativeInputSourceReceipt'->'dispatches')='array'
        THEN jsonb_array_length(producer.runner_profile_json->'nativeInputSourceReceipt'->'dispatches') ELSE -1 END OR
    CASE WHEN (receipt->>'originalAdditionalInputCount') ~ '^(0|[1-9][0-9]{0,2})$'
      THEN (receipt->>'originalAdditionalInputCount')::integer ELSE -1 END IS DISTINCT FROM
      CASE WHEN jsonb_typeof(producer.runner_profile_json->'nativeInputSourceReceipt'->'additionalInputs')='array'
        THEN jsonb_array_length(producer.runner_profile_json->'nativeInputSourceReceipt'->'additionalInputs') ELSE -1 END OR
    step->>'receiptHash' IS DISTINCT FROM encode(sha256(convert_to(receipt::text,'UTF8')),'hex') OR
    receipt->>'version' IS DISTINCT FROM '1' OR receipt->>'companyId' IS DISTINCT FROM NEW.company_id::text OR
    receipt->>'issueId' IS DISTINCT FROM NEW.id::text OR receipt->>'runId' IS DISTINCT FROM producer.id::text OR
    receipt->>'agentId' IS DISTINCT FROM producer.agent_id::text OR
    receipt->>'responsibleUserId' IS DISTINCT FROM producer.responsible_user_id OR
    receipt->>'transitionId' IS DISTINCT FROM step->>'transitionId' OR
    receipt->'owner'->>'kind' IS DISTINCT FROM step->>'ownerKind' OR
    receipt->'owner'->>'decisionId' IS DISTINCT FROM step->>'decisionId' OR
    receipt->'owner'->>'runId' IS DISTINCT FROM producer.id::text OR
    receipt->'originalSnapshot' IS DISTINCT FROM OLD.payload_source_snapshot OR
    receipt->>'previousOwnerContentHash' IS DISTINCT FROM step->>'previousOwnerContentHash' OR
    receipt->>'nextOwnerContentHash' IS DISTINCT FROM step->>'nextOwnerContentHash' OR
    receipt->'fromExecutionState' IS DISTINCT FROM coalesce(OLD.execution_state,'null'::jsonb) OR
    receipt->'toExecutionState' IS DISTINCT FROM coalesce(NEW.execution_state,'null'::jsonb) OR
    receipt->'fromUnblockDescriptor' IS DISTINCT FROM coalesce(OLD.unblock_descriptor,'null'::jsonb) OR
    receipt->'toUnblockDescriptor' IS DISTINCT FROM coalesce(NEW.unblock_descriptor,'null'::jsonb) OR
    receipt->>'originalInputReceiptDigest' IS DISTINCT FROM producer.runner_profile_json->'nativeInputSourceReceipt'->>'digest' OR
    receipt->>'executionInputDigest' IS DISTINCT FROM producer.runner_profile_json->'nativeInputSourceReceipt'->'bootstrap'->>'executionInputDigest' OR
    producer.runner_profile_json->'nativeBootstrapTaskSource'->'payloadSourceSnapshot' IS DISTINCT FROM OLD.payload_source_snapshot OR
    producer.runner_profile_json->'nativeBootstrapTaskSource'->'input'->>'kind' IS DISTINCT FROM 'task' OR
    producer.runner_profile_json->'nativeBootstrapTaskSource'->'input'->>'issueId' IS DISTINCT FROM NEW.id::text OR
    producer.runner_profile_json->'nativeBootstrapTaskSource'->'input'->>'contentHash' IS DISTINCT FROM step->>'previousOwnerContentHash' THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Native Stage source is not bound to its actual producer receipt';
  END IF;
  IF step->>'ownerKind'='native_status_decision' THEN
    IF NEW.last_status_decision_id::text IS DISTINCT FROM step->>'decisionId' OR NOT EXISTS (
      SELECT 1 FROM public.status_decisions d
      JOIN public.native_run_finalizations f ON f.company_id=d.company_id AND f.issue_id=d.issue_id AND
        f.run_id=d.run_id AND f.decision_id=d.id AND f.assessment_id=d.assessment_id AND f.phase='committed'
      JOIN public.native_run_results r ON r.company_id=f.company_id AND r.issue_id=f.issue_id AND
        r.run_id=f.run_id AND r.id=f.result_id AND r.schema_status='accepted'
      JOIN public.work_assessments a ON a.company_id=d.company_id AND a.issue_id=d.issue_id AND
        a.run_id=d.run_id AND a.id=d.assessment_id AND a.result_id=r.id AND a.contract_id=r.completion_contract_id
      JOIN public.status_decision_effects e ON e.company_id=d.company_id AND e.issue_id=d.issue_id AND
        e.decision_id=d.id AND e.effect_kind='execution_stage_wake' AND e.target_type='agent_wakeup_request'
      JOIN public.agent_wakeup_requests w ON w.company_id=e.company_id AND w.id::text=e.target_id AND
        w.requested_by_actor_type='agent' AND w.requested_by_actor_id=producer.agent_id::text AND
        w.idempotency_key='issue.execution_stage:'||NEW.id::text||':'||d.id::text
      WHERE d.company_id=NEW.company_id AND d.issue_id=NEW.id AND d.run_id=producer.id AND
        d.id::text=step->>'decisionId' AND d.application_state='applied' AND d.applied_at IS NOT NULL AND
        d.reason_code='execution_policy_stage_pending' AND d.to_status='in_review' AND
        d.decision_json->'unblockDescriptor' IS NOT DISTINCT FROM coalesce(NEW.unblock_descriptor,'null'::jsonb) AND
        e.payload->'executionStage' IS NOT DISTINCT FROM w.payload->'executionStage' AND
        w.agent_id::text=NEW.execution_state->'currentParticipant'->>'agentId' AND
        w.payload->'executionStage'->>'stageId' IS NOT DISTINCT FROM NEW.execution_state->>'currentStageId'
    ) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Native Stage source lacks its applied entry decision and wake effect'; END IF;
  ELSE
    receipt_key:=encode(sha256(convert_to(receipt->'owner'->'effect'->>'callId','UTF8')),'hex');
    IF NOT EXISTS (
      SELECT 1 FROM public.issue_execution_decisions d JOIN public.issue_comments c ON c.company_id=d.company_id AND
        c.issue_id=d.issue_id AND c.id::text=receipt->'owner'->>'commentId' AND c.created_by_run_id=producer.id AND
        c.author_agent_id=producer.agent_id AND c.author_user_id IS NULL AND c.author_type='agent' AND c.deleted_at IS NULL
      WHERE d.company_id=NEW.company_id AND d.issue_id=NEW.id AND d.created_by_run_id=producer.id AND
        d.actor_agent_id=producer.agent_id AND d.actor_user_id IS NULL AND d.id::text=step->>'decisionId' AND
        d.id::text=NEW.execution_state->>'lastDecisionId' AND d.outcome=NEW.execution_state->>'lastDecisionOutcome' AND
        d.stage_id IS NOT DISTINCT FROM OLD.execution_state->>'currentStageId' AND
        CASE WHEN jsonb_typeof(producer.result_json->'nativeStagePolicyTransitions'->receipt_key)='object'
          THEN (SELECT count(*) FROM jsonb_object_keys(producer.result_json->'nativeStagePolicyTransitions'->receipt_key)) ELSE -1 END=19 AND
        (producer.result_json->'nativeStagePolicyTransitions'->receipt_key) ?& ARRAY['version','origin','companyId','issueId','runId','agentId',
          'responsibleUserId','originalReceiptDigest','originalDispatchCount','originalAdditionalInputCount','executionInputDigest',
          'stageSource','effect','fromState','toState','stageDecisionId','stageDecisionHash','commentId','commentHash'] AND
        producer.result_json->'nativeStagePolicyTransitions'->receipt_key->>'stageDecisionId'=d.id::text AND
        producer.result_json->'nativeStagePolicyTransitions'->receipt_key->>'originalReceiptDigest' IS NOT DISTINCT FROM receipt->>'originalInputReceiptDigest' AND
        producer.result_json->'nativeStagePolicyTransitions'->receipt_key->>'originalDispatchCount' IS NOT DISTINCT FROM receipt->>'originalDispatchCount' AND
        producer.result_json->'nativeStagePolicyTransitions'->receipt_key->>'originalAdditionalInputCount' IS NOT DISTINCT FROM receipt->>'originalAdditionalInputCount' AND
        producer.result_json->'nativeStagePolicyTransitions'->receipt_key->'effect' IS NOT DISTINCT FROM receipt->'owner'->'effect' AND
        producer.result_json->'nativeStagePolicyTransitions'->receipt_key->'toState' IS NOT DISTINCT FROM NEW.execution_state
    ) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Native Stage source lacks its actual approval-comment effect'; END IF;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER issues_native_stage_source_owner
AFTER UPDATE ON public.issues DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.aw_issue_native_stage_source_owner();
