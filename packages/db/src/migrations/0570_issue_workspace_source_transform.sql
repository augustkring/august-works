-- A manual related Task's literal Human text remains the same source input when
-- Native binds its execution workspace. Record that narrowly bounded owner
-- transition; never let a generic UPDATE restamp or discard its source history.
CREATE FUNCTION public.aw_issue_workspace_source_transform() RETURNS trigger
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
      AND r.runtime_mode='native' AND (coalesce(r.native_issue_id,r.issue_id)=NEW.id);
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
CREATE TRIGGER issues_payload_workspace_source_transform
BEFORE INSERT OR UPDATE ON public.issues
FOR EACH ROW EXECUTE FUNCTION public.aw_issue_workspace_source_transform();
