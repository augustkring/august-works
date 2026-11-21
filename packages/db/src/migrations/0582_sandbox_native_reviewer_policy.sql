-- MS1h2/MS1h3. The current Native completion Reviewer of one exact Run and
-- manifest: the SQL mirror of currentNativeReviewerRun and the
-- getNativeReviewAssignment checks it uses (native-review-participant.ts).
-- Every row is read in the Run's company. It grants nothing by itself.
CREATE OR REPLACE FUNCTION aw_v10_current_native_reviewer_run(c uuid, a uuid, rid uuid, iid uuid, mid uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
SELECT EXISTS (
  SELECT 1
  FROM heartbeat_runs r
  JOIN issues i ON i.company_id=r.company_id AND i.id=iid
  JOIN agent_execution_manifests m ON m.company_id=r.company_id AND m.id=mid AND m.run_id=r.id AND m.agent_id=r.agent_id
  JOIN agents reviewer ON reviewer.company_id=r.company_id AND reviewer.id=r.agent_id
  JOIN issue_thread_interactions it ON it.company_id=r.company_id AND it.issue_id=i.id
    AND it.id::text=r.context_snapshot->>'nativeReviewInteractionId'
  JOIN status_decisions d ON d.company_id=r.company_id AND d.issue_id=i.id
    AND d.id::text=r.context_snapshot->>'nativeReviewDecisionId'
  JOIN heartbeat_runs s ON s.company_id=r.company_id AND s.id=d.run_id AND s.agent_id=i.assignee_agent_id
    AND s.native_issue_id=i.id
  WHERE r.company_id=c AND r.id=rid AND r.agent_id=a
    -- 3. The Reviewer's running Native Run on this Task with its responsible Human.
    AND r.status='running' AND r.runtime_mode='native' AND r.native_issue_id=i.id AND r.responsible_user_id IS NOT NULL
    -- 2. The Task is in review and this Run holds its execution lease.
    AND i.status='in_review' AND i.execution_run_id=r.id
    -- 3. This Run's own manifest names the same Human.
    AND m.manifest->>'responsibleUserId'=r.responsible_user_id
    -- 1. The persisted review wake (readNativeReviewAssignmentContext) binds this interaction and decision.
    AND jsonb_typeof(r.context_snapshot)='object'
    AND r.context_snapshot->>'nativeReviewInteractionId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND r.context_snapshot->>'nativeReviewDecisionId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND (NOT (r.context_snapshot ? 'issueId') OR r.context_snapshot->'issueId'=to_jsonb(i.id::text))
    AND (NOT (r.context_snapshot ? 'sourceRunId') OR r.context_snapshot->'sourceRunId'=to_jsonb(s.id::text))
    AND (NOT (r.context_snapshot ? 'revisionId') OR r.context_snapshot->'revisionId'=to_jsonb(d.id::text))
    -- 1. The Reviewer is invokable (evaluateAgentInvokability): an invokable status and a
    -- reporting chain with no terminated ancestor, missing manager or cycle in this company.
    AND reviewer.status IN ('active','idle','running','error')
    AND NOT EXISTS (
      WITH RECURSIVE chain(id, reports_to, status, path, cycle) AS (
        SELECT reviewer.id, reviewer.reports_to, reviewer.status, ARRAY[reviewer.id], false
        UNION ALL
        SELECT p.id, p.reports_to, p.status, chain.path || p.id, p.id = ANY(chain.path)
        FROM chain JOIN agents p ON p.company_id=r.company_id AND p.id=chain.reports_to
        WHERE NOT chain.cycle
      )
      SELECT 1 FROM chain
      WHERE chain.cycle
        OR (chain.id<>reviewer.id AND chain.status='terminated')
        OR (NOT chain.cycle AND chain.reports_to IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM agents manager WHERE manager.company_id=r.company_id AND manager.id=chain.reports_to))
    )
    -- 1. The applied source decision and its native completion review, addressed to this Agent.
    AND s.agent_id<>r.agent_id
    AND d.application_state='applied'
    AND it.kind='request_confirmation'
    AND it.source_run_id=d.run_id AND it.source_run_id=s.id
    AND it.addressee_agent_id=r.agent_id AND it.addressee_user_id IS NULL
    AND (it.payload->'toolAction' IS NULL OR it.payload->'toolAction' IN ('null'::jsonb, 'false'::jsonb, '""'::jsonb)
      OR (jsonb_typeof(it.payload->'toolAction')='number' AND (it.payload->>'toolAction')::numeric=0))
    AND (it.payload->'secretProposal' IS NULL OR it.payload->'secretProposal' IN ('null'::jsonb, 'false'::jsonb, '""'::jsonb)
      OR (jsonb_typeof(it.payload->'secretProposal')='number' AND (it.payload->>'secretProposal')::numeric=0))
    AND it.payload->'target'->'type'='"custom"'::jsonb
    AND it.payload->'target'->'key'='"native_completion_review"'::jsonb
    AND it.payload->'target'->'revisionId'=to_jsonb(d.id::text)
    AND it.effective_resolver_policy NOT IN ('human_only','board_only')
    -- 1. Still pending on the exact projected Task status the decision applied.
    AND it.status='pending'
    AND i.last_status_decision_id=d.id
    AND jsonb_typeof(d.decision_json->'projectedStatusVersion')='number'
    AND (d.decision_json->>'projectedStatusVersion')::numeric=i.status_version
    -- 4. The reviewed source Run succeeded, is committed and its process cleanup is done.
    AND s.status='succeeded' AND s.native_phase='committed' AND s.native_process_cleanup_pending IS FALSE
)
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v7_sandbox_policy_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b runtime_sandbox_bindings; c runtime_cells; m agent_execution_manifests;
BEGIN
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') THEN RAISE EXCEPTION 'sandbox_policy_snapshot_immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND OLD.status IN ('superseded','revoked') AND NEW.status<>OLD.status THEN RAISE EXCEPTION 'sandbox_policy_cannot_revive' USING ERRCODE='23514'; END IF;
 SELECT * INTO b FROM runtime_sandbox_bindings WHERE company_id=NEW.company_id AND id=NEW.binding_id;
 SELECT * INTO c FROM runtime_cells WHERE company_id=NEW.company_id AND id=NEW.runtime_cell_id;
 SELECT * INTO m FROM agent_execution_manifests WHERE company_id=NEW.company_id AND id=NEW.execution_manifest_id;
 IF b.runtime_cell_id<>NEW.runtime_cell_id OR m.agent_id<>NEW.agent_id THEN RAISE EXCEPTION 'sandbox_policy_source_scope_mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.status='qualified' THEN
  IF b.status NOT IN ('ready','stopped') OR c.status<>'STOPPED' OR b.cell_generation<>c.generation::text OR c.deleted_at IS NOT NULL OR NEW.expires_at<=now() OR NEW.compilation->>'proverResult'<>'pass' OR NEW.compilation->'compiledPolicy'->>'riskClass'='C4' OR NEW.capability_snapshot_hash IS DISTINCT FROM b.capability_snapshot_hash OR (b.capability_snapshot->>'expiresAt')::timestamptz<=now() OR NOT EXISTS(SELECT 1 FROM instance_settings WHERE singleton_key='default' AND experimental->>'sandbox_abstraction_v7'='true') OR NOT EXISTS(
   SELECT 1 FROM heartbeat_runs r JOIN issues i ON i.company_id=r.company_id AND i.id=r.native_issue_id
   WHERE r.company_id=m.company_id AND r.id=m.run_id AND r.agent_id=m.agent_id AND r.status='running'
    AND (i.assignee_agent_id=m.agent_id
      OR (i.hidden_at IS NULL AND aw_v10_current_native_reviewer_run(m.company_id, m.agent_id, m.run_id, i.id, m.id)))
    AND r.responsible_user_id=m.manifest->>'responsibleUserId'
    AND (
      i.hidden_at IS NULL
      OR (
        i.hidden_at IS NOT NULL AND i.status='in_progress' AND i.harness_kind='provider_conformance'
        AND r.runtime_mode='native' AND r.scope_kind='issue'
        AND r.runner_profile_json->'nativeExecutionInput'->'binding'->>'companyId'=r.company_id::text
        AND r.runner_profile_json->'nativeExecutionInput'->'binding'->>'runId'=r.id::text
        AND r.runner_profile_json->'nativeExecutionInput'->'binding'->>'issueId'=i.id::text
        AND r.runner_profile_json->'nativeExecutionInput'->'binding'->>'agentId'=r.agent_id::text
        AND i.execution_run_id=r.id AND r.native_issue_id=i.id AND r.trigger_detail='provider_conformance'
        AND r.responsible_user_id IS NOT NULL AND i.responsible_user_id=r.responsible_user_id
        AND m.run_id=r.id AND m.agent_id=r.agent_id AND m.manifest->>'responsibleUserId'=r.responsible_user_id
        AND EXISTS (SELECT 1 FROM company_memberships cm WHERE cm.company_id=r.company_id
          AND cm.principal_type='user' AND cm.principal_id=r.responsible_user_id AND cm.status='active')
        AND m.manifest->'executionScope'->>'primaryCompanyId'=r.company_id::text
        AND m.manifest->'executionScope'->>'primaryAgentPresenceId'=r.agent_id::text
        AND m.manifest->'executionScope'->'delegatedScopes'='[]'::jsonb
        AND m.manifest->'capabilities'='[]'::jsonb
        AND EXISTS (
          SELECT 1 FROM orchestration_plans p
          WHERE p.company_id=r.company_id AND p.issue_id=i.id
            AND p.id::text=r.context_snapshot->>'providerConformancePlanId'
            AND r.context_snapshot->>'providerConformanceGroupId' IS NOT NULL
            AND p.status='paused' AND p.action_class='internal_draft' AND p.risk_class='C0'
            AND p.mode='single_worker' AND p.retries_used=0 AND p.tool_actions_used=0
            AND p.created_by=r.responsible_user_id AND p.started_at IS NOT NULL
            AND p.execution_principal->>'type'='user' AND p.execution_principal->>'userId'=r.responsible_user_id
            AND p.budgets->>'maxToolActions'='0' AND p.budgets->>'maxRetries'='0'
            AND p.budgets->>'maxWorkerCount'='1' AND p.budgets->>'maxParallelWorkers'='1' AND p.budgets->>'maxDelegationDepth'='0'
            AND r.context_snapshot->'containsCompanyContext'='false'::jsonb
            AND r.context_snapshot->'platformToolsGranted'='false'::jsonb
            AND NOT EXISTS (SELECT 1 FROM orchestration_workers w WHERE w.company_id=p.company_id AND w.plan_id=p.id)
            AND NOT EXISTS (SELECT 1 FROM orchestration_worker_attempts a WHERE a.company_id=p.company_id AND a.plan_id=p.id)
            AND NOT EXISTS (SELECT 1 FROM orchestration_tool_charges tc WHERE tc.company_id=p.company_id AND tc.plan_id=p.id)
        )
        AND EXISTS (
          SELECT 1 FROM environment_leases l
          WHERE l.company_id=r.company_id AND l.heartbeat_run_id=r.id AND l.issue_id=i.id
            AND l.status='active' AND l.expires_at>now()
            AND l.metadata->>'remoteCwd' ~ '^/'
            AND l.metadata->>'remoteCwd' !~ '/(\.\.?)(/|$)'
            AND jsonb_typeof(l.metadata)='object'
            AND r.runner_profile_json->'nativeOpenCodeConformanceWorkspace'->>'schema'='paperclip.native-opencode-conformance-workspace/v1'
            AND r.runner_profile_json->'nativeOpenCodeConformanceWorkspace'->>'companyId'=r.company_id::text
            AND r.runner_profile_json->'nativeOpenCodeConformanceWorkspace'->>'agentId'=r.agent_id::text
            AND r.runner_profile_json->'nativeOpenCodeConformanceWorkspace'->>'taskId'=i.id::text
            AND r.runner_profile_json->'nativeOpenCodeConformanceWorkspace'->>'groupId'=r.context_snapshot->>'providerConformanceGroupId'
            AND r.runner_profile_json->'nativeOpenCodeConformanceWorkspace'->>'leaseId'=l.id::text
            AND r.runner_profile_json->'nativeOpenCodeConformanceWorkspace'->>'taskRoot'=l.metadata->>'remoteCwd'
            AND r.runner_profile_json->'nativeOpenCodeConformanceWorkspace'->>'localCwd'=l.metadata->>'remoteCwd'
            AND r.runner_profile_json->'nativeOpenCodeConformanceWorkspace'->>'remoteCwd'=l.metadata->>'remoteCwd'
            AND r.runner_profile_json->'nativeOpenCodeConformanceWorkspace'->>'creationReceipt' ~ '^[a-f0-9]{64}$'
            AND jsonb_typeof(r.runner_profile_json->'nativeOpenCodeConformanceWorkspace'->'createdEmpty')='boolean'
            AND r.runner_profile_json->'nativeOpenCodeConformanceWorkspace'->'authorityHash'='null'::jsonb
            AND NOT (r.runner_profile_json->'nativeOpenCodeConformanceWorkspace' ? 'descriptorSha256')
            AND NOT (r.runner_profile_json->'nativeOpenCodeConformanceWorkspace' ? 'baselineSha256')
            AND NOT (r.runner_profile_json->'nativeOpenCodeConformanceWorkspace' ? 'workspaceRepositoryMode')
            AND r.runner_profile_json->'nativeOpenCodeConformanceWorkspace'->>'workspaceId'=r.runner_profile_json->'nativeExecutionInput'->'binding'->>'executionWorkspaceId'
            AND r.runner_profile_json->'nativeOpenCodeConformanceWorkspace'->>'providerLeaseId'=l.provider_lease_id
        )
        AND jsonb_array_length(NEW.compilation->'compiledPolicy'->'filesystem'->'writePaths')=1
        AND NEW.compilation->'compiledPolicy'->'filesystem'->'writePaths'->>0=
          r.runner_profile_json->'nativeOpenCodeConformanceWorkspace'->>'taskRoot'
        AND NEW.compilation->'compiledPolicy'->>'riskClass'='C0'
        AND NEW.compilation->'compiledPolicy'->'network'->'defaultDeny'='true'::jsonb
        AND NEW.compilation->'compiledPolicy'->'network'->'denyPrivateAndMetadata'='true'::jsonb
        AND NEW.compilation->'compiledPolicy'->'credentials'->>'mode'='none'
        AND NEW.compilation->'compiledPolicy'->'credentials'->'bindings'='[]'::jsonb
        AND NEW.compilation->'modelBrokerEndpoint'->>'path'='/runtime-tools/model/v1/messages'
        AND NEW.compilation->'modelBrokerEndpoint'->'binaries'=b.capability_snapshot->'modelBrokerProviderProfile'->'binaries'
        AND jsonb_typeof(b.capability_snapshot->'modelBrokerProviderProfile'->'binaries')='array'
        AND lower(b.capability_snapshot->'modelBrokerProviderProfile'->>'origin') ~ '^https://[a-z0-9.-]+(:[0-9]+)?/?$'
        AND lower(regexp_replace(regexp_replace(b.capability_snapshot->'modelBrokerProviderProfile'->>'origin','^https://',''), '/$', '')) =
          (lower(NEW.compilation->'modelBrokerEndpoint'->>'hostname' ||
          CASE WHEN NEW.compilation->'modelBrokerEndpoint'->>'port'='443' THEN ''
            ELSE ':'||(NEW.compilation->'modelBrokerEndpoint'->>'port') END))
        AND jsonb_typeof(NEW.compilation->'compiledPolicy'->'filesystem'->'readPaths')='array'
        AND NEW.compilation->'compiledPolicy'->'filesystem'->'readPaths' = (
          SELECT jsonb_agg(value ORDER BY value) FROM (
            SELECT DISTINCT item AS value
            FROM jsonb_array_elements_text(b.capability_snapshot->'modelBrokerProviderProfile'->'binaries') AS cap_bin(item)
            UNION SELECT r.runner_profile_json->'nativeOpenCodeConformanceWorkspace'->>'taskRoot' AS value
            UNION SELECT '/.openshell/runtime/openshell-sandbox' AS value
          ) allowed_read_path
        )
        AND jsonb_array_length(NEW.compilation->'compiledPolicy'->'network'->'destinations')=1
        AND NEW.compilation->'compiledPolicy'->'network'->'destinations'->0->>'hostname'=NEW.compilation->'modelBrokerEndpoint'->>'hostname'
        AND NEW.compilation->'compiledPolicy'->'network'->'destinations'->0->>'port'=NEW.compilation->'modelBrokerEndpoint'->>'port'
        AND NEW.compilation->'compiledPolicy'->'network'->'destinations'->0->'methods'='["POST"]'::jsonb
        AND NEW.compilation->'compiledPolicy'->'network'->'destinations'->0->'pathPrefixes'='["/runtime-tools/model/v1/messages"]'::jsonb
      )
    )
  ) THEN RAISE EXCEPTION 'sandbox_policy_current_execution_required' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
