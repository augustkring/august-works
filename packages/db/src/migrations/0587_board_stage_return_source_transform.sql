-- MS1f stop 5. A board return of a Task from a pending execution stage to its
-- round's executor (the PATCH board override) clears execution_state, a Task
-- body field. Without a transform the service nulls the Task source snapshot
-- and aw_native_payload_source_binding invalidates it for good, so no Native
-- Run could use the Task again. This adds one Task source transform kind,
-- board_stage_return. aw_issue_workspace_source_transform() is 0571's
-- definition with one added branch (no other change); the board's activity,
-- authority and round decision are checked at commit by a new deferred owner
-- trigger. 0513's binding function is unchanged.
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
  -- MS1f stop 5 (0587). The board's return of a Task from a pending execution
  -- stage to its round's executor: exactly execution_state from that pending
  -- stage to NULL, with the assignee moving from the stage participant to the
  -- executor. Every other body field is unchanged; the source closure and the
  -- previousSnapshotDigest/owner-hash chain are kept. The board's issue.updated
  -- activity, its authority and the round decision are checked at commit.
  IF jsonb_typeof(new_transforms)='array' AND jsonb_array_length(new_transforms)>0 AND
     new_transforms->(jsonb_array_length(new_transforms)-1)->>'kind'='board_stage_return' THEN
    n:=jsonb_array_length(old_transforms);
    step:=new_transforms->n;
    IF OLD.payload_source_protocol_version<>1 OR OLD.payload_source_snapshot_invalidated OR
       NEW.payload_source_snapshot_invalidated OR OLD.conversation_agent_id IS NOT NULL OR
       jsonb_typeof(old_transforms)<>'array' OR jsonb_array_length(new_transforms)<>n+1 OR n>=32 OR
       jsonb_typeof(step) IS DISTINCT FROM 'object' OR
       OLD.payload_source_snapshot->'policy' IS DISTINCT FROM NEW.payload_source_snapshot->'policy' OR
       OLD.payload_source_snapshot->'inputs' IS DISTINCT FROM NEW.payload_source_snapshot->'inputs' OR
       OLD.payload_source_snapshot->>'digest' IS DISTINCT FROM step->>'previousSnapshotDigest' OR
       OLD.payload_source_snapshot->'owner'->>'contentHash' IS DISTINCT FROM step->>'previousOwnerContentHash' OR
       NEW.payload_source_snapshot->'owner'->>'contentHash' IS DISTINCT FROM step->>'nextOwnerContentHash' OR
       public.aw_native_payload_body_hash('issue',to_jsonb(OLD)) IS DISTINCT FROM step->>'previousOwnerContentHash' OR
       public.aw_native_payload_body_hash('issue',to_jsonb(NEW)) IS DISTINCT FROM step->>'nextOwnerContentHash' OR
       public.aw_native_payload_body_hash('issue',to_jsonb(NEW) || jsonb_build_object(
         'execution_state',OLD.execution_state)) IS DISTINCT FROM public.aw_native_payload_body_hash('issue',to_jsonb(OLD)) OR
       NEW.execution_state IS NOT NULL OR jsonb_typeof(OLD.execution_state) IS DISTINCT FROM 'object' OR
       OLD.execution_state->>'status' IS DISTINCT FROM 'pending' OR
       OLD.execution_state->>'currentStageId' IS DISTINCT FROM step->>'stageId' OR
       OLD.execution_state->'currentParticipant'->>'type' IS DISTINCT FROM 'agent' OR
       OLD.execution_state->'currentParticipant'->>'agentId' IS DISTINCT FROM step->>'participantAgentId' OR
       OLD.execution_state->'returnAssignee'->>'type' IS DISTINCT FROM 'agent' OR
       OLD.execution_state->'returnAssignee'->>'agentId' IS DISTINCT FROM step->>'executorAgentId' OR
       step->>'participantAgentId' IS NOT DISTINCT FROM step->>'executorAgentId' OR
       OLD.assignee_agent_id::text IS DISTINCT FROM step->>'participantAgentId' OR
       NEW.assignee_agent_id::text IS DISTINCT FROM step->>'executorAgentId' OR
       OLD.assignee_user_id IS NOT NULL OR NEW.assignee_user_id IS NOT NULL OR
       OLD.status IS DISTINCT FROM 'in_review' OR NEW.status IN ('in_review','done','cancelled') OR
       OLD.last_status_decision_id::text IS DISTINCT FROM step->>'decisionId' OR
       NEW.last_status_decision_id IS DISTINCT FROM OLD.last_status_decision_id OR
       OLD.payload_source_snapshot->>'digest' IS DISTINCT FROM encode(sha256(convert_to((OLD.payload_source_snapshot-'digest')::text,'UTF8')),'hex') OR
       NEW.payload_source_snapshot->>'digest' IS DISTINCT FROM encode(sha256(convert_to((NEW.payload_source_snapshot-'digest')::text,'UTF8')),'hex') THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Board Stage return source must change only the returned stage';
    END IF;
    IF n>0 THEN FOR i IN 0..n-1 LOOP
      IF old_transforms->i IS DISTINCT FROM new_transforms->i OR
         old_transforms->i->>'activityId' IS NOT DISTINCT FROM step->>'activityId' THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Board Stage return source history is append-only and single-use';
      END IF;
    END LOOP; END IF;
    SELECT count(*) INTO step_key_count FROM jsonb_object_keys(step);
    IF step_key_count<>11 OR NOT (step ?& ARRAY['kind','transitionId','activityId','stageId','participantAgentId',
       'executorAgentId','decisionId','taskStatusVersion','previousSnapshotDigest','previousOwnerContentHash','nextOwnerContentHash']) OR
       jsonb_typeof(step->'taskStatusVersion') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Board Stage return source transform has unknown fields';
    END IF;
    RETURN NEW;
  END IF;
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
CREATE FUNCTION public.aw_issue_board_stage_return_source_owner() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE step jsonb; act public.activity_log%ROWTYPE;
BEGIN
  step:=NEW.payload_source_snapshot->'transforms'->(jsonb_array_length(NEW.payload_source_snapshot->'transforms')-1);
  SELECT * INTO act FROM public.activity_log a WHERE a.company_id=NEW.company_id AND
    a.id::text=step->>'activityId' AND a.entity_type='issue' AND a.entity_id=NEW.id::text AND
    a.action='issue.updated' AND a.actor_type='user' AND a.agent_id IS NULL AND a.run_id IS NULL;
  IF act.id IS NULL OR jsonb_typeof(act.details->'changes') IS DISTINCT FROM 'object' OR
    act.details->'changes'->'executionState'->'to' IS DISTINCT FROM 'null'::jsonb OR
    act.details->'changes'->'executionState'->'from' IS DISTINCT FROM OLD.execution_state OR
    act.details->'changes'->'assigneeAgentId'->>'from' IS DISTINCT FROM step->>'participantAgentId' OR
    act.details->'changes'->'assigneeAgentId'->>'to' IS DISTINCT FROM step->>'executorAgentId' OR
    act.details->'changes'->'status'->>'from' IS DISTINCT FROM 'in_review' OR
    act.details->'changes'->'status'->>'to' IS DISTINCT FROM NEW.status OR
    act.details->'changes'->'statusVersion'->'to' IS DISTINCT FROM step->'taskStatusVersion' OR
    to_jsonb(NEW.status_version) IS DISTINCT FROM step->'taskStatusVersion' OR
    act.details->'changes' ? 'lastStatusDecisionId' OR
    (NOT EXISTS (SELECT 1 FROM public.company_memberships m WHERE m.company_id=NEW.company_id AND
      m.principal_type='user' AND m.principal_id=act.actor_id AND m.status='active' AND
      m.membership_role IS DISTINCT FROM 'viewer') AND
     NOT EXISTS (SELECT 1 FROM public.instance_user_roles u WHERE u.user_id=act.actor_id AND u.role='instance_admin')) OR
    NOT EXISTS (SELECT 1 FROM public.status_decisions d JOIN public.heartbeat_runs r ON r.company_id=d.company_id AND r.id=d.run_id
      WHERE d.company_id=NEW.company_id AND d.issue_id=NEW.id AND d.id::text=step->>'decisionId' AND
        d.application_state='applied' AND d.applied_at IS NOT NULL AND d.applied_at<=act.created_at AND
        d.reason_code='execution_policy_stage_pending' AND d.to_status='in_review' AND
        r.native_issue_id=NEW.id AND r.runtime_mode='native' AND r.agent_id::text=step->>'executorAgentId') THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Board Stage return source lacks the board''s return and its round decision';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER issues_board_stage_return_source_owner
AFTER UPDATE ON public.issues DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW WHEN (
  CASE
    WHEN jsonb_typeof(coalesce(OLD.payload_source_snapshot->'transforms','[]'::jsonb))='array' AND
         jsonb_typeof(NEW.payload_source_snapshot->'transforms')='array'
    THEN jsonb_array_length(NEW.payload_source_snapshot->'transforms') =
           jsonb_array_length(coalesce(OLD.payload_source_snapshot->'transforms','[]'::jsonb)) + 1 AND
         jsonb_array_length(NEW.payload_source_snapshot->'transforms') > 0 AND
         NEW.payload_source_snapshot->'transforms'->
           (jsonb_array_length(NEW.payload_source_snapshot->'transforms') - 1)->>'kind'='board_stage_return'
    ELSE false
  END
)
EXECUTE FUNCTION public.aw_issue_board_stage_return_source_owner();
