-- The typed server-authored runtime Stop is the lookup key for the derived
-- prelaunch settlement. Keep ordinary runtime-operation rows out of this index.
CREATE INDEX IF NOT EXISTS runtime_operations_native_prelaunch_cleanup_owner_idx
  ON public.runtime_operations (company_id, ((desired_state->'nativeBootstrapPrelaunchCleanup'->>'runId')), runtime_cell_id)
  WHERE operation_type='stop' AND status='SUCCEEDED' AND requested_by_type='system'
    AND requested_by_id='native-bootstrap-cleanup' AND desired_state ? 'nativeBootstrapPrelaunchCleanup';
--> statement-breakpoint
-- Separate physical setup-container settlement. This is NOT a Native process
-- stop projection: it never mutates native_process_cleanup_pending or appends a
-- heartbeat lifecycle event. The only source is the canonical server-authored
-- runtime Stop operation created after the signed Stop + later independent
-- Inspect verifier succeeds. This predicate rechecks the exact owner facts at
-- every occupancy read so contradictory/new evidence restores the hold.
CREATE OR REPLACE FUNCTION public.aw_v10_native_prelaunch_container_cleanup_completed(
  target_company uuid, target_run uuid
) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public
SET jit = off SET join_collapse_limit = 1 SET from_collapse_limit = 1 AS $$
BEGIN
  -- Most occupancy candidates have no completed setup-container Stop. Use its
  -- narrow index before planning the complete immutable owner proof.
  IF NOT EXISTS (SELECT 1 FROM public.runtime_operations o WHERE o.company_id=target_company
    AND o.operation_type='stop' AND o.status='SUCCEEDED' AND o.requested_by_type='system'
    AND o.requested_by_id='native-bootstrap-cleanup' AND o.desired_state ? 'nativeBootstrapPrelaunchCleanup'
    AND o.desired_state->'nativeBootstrapPrelaunchCleanup'->>'runId'=target_run::text) THEN
    RETURN false;
  END IF;
  RETURN COALESCE(EXISTS (
    SELECT 1
    FROM public.heartbeat_runs h
    JOIN public.native_run_finalizations f ON f.company_id=h.company_id AND f.run_id=h.id
    JOIN public.environment_leases l ON l.company_id=h.company_id AND l.heartbeat_run_id=h.id
    JOIN public.runtime_operations o ON o.company_id=h.company_id
      AND o.runtime_cell_id IS NOT NULL
      AND o.desired_state->'nativeBootstrapPrelaunchCleanup'->>'companyId'=h.company_id::text
      AND o.operation_type='stop' AND o.status='SUCCEEDED' AND o.requested_by_type='system'
      AND o.requested_by_id='native-bootstrap-cleanup'
      AND o.desired_state->'nativeBootstrapPrelaunchCleanup'->>'runId'=h.id::text
    JOIN public.runtime_cells c ON c.company_id=h.company_id AND c.id=o.runtime_cell_id
    JOIN public.runtime_hosts host ON host.id=c.runtime_host_id
    JOIN public.runtime_sandbox_bindings b ON b.company_id=h.company_id
      AND b.id=(o.desired_state->>'sandboxBindingId')::uuid AND b.runtime_cell_id=c.id
    JOIN public.runtime_host_commands stop ON stop.company_id=h.company_id
      AND stop.id=(o.desired_state->>'sandboxHostCommandId')::uuid
    JOIN public.runtime_host_commands inspect ON inspect.company_id=h.company_id
      AND inspect.id=(o.desired_state->'nativeBootstrapPrelaunchCleanup'->>'inspectCommandId')::uuid
    JOIN public.agent_execution_manifests manifest ON manifest.company_id=h.company_id
      AND manifest.id=(o.desired_state->>'executionManifestId')::uuid AND manifest.run_id=h.id AND manifest.agent_id=h.agent_id
    JOIN public.runtime_policy_snapshots policy ON policy.company_id=h.company_id
      AND policy.id=(o.desired_state->>'policySnapshotId')::uuid AND policy.binding_id=b.id
      AND policy.execution_manifest_id=manifest.id
    JOIN public.runtime_host_commands prep ON prep.company_id=h.company_id
      AND prep.id=(stop.payload->'__nativeBootstrapPrelaunchCleanup'->'owner'->>'prepareCommandId')::uuid
    JOIN public.runtime_host_commands apply_cmd ON apply_cmd.company_id=h.company_id
      AND apply_cmd.id=(stop.payload->'__nativeBootstrapPrelaunchCleanup'->'owner'->>'applyCommandId')::uuid
    JOIN public.runtime_host_commands start_cmd ON start_cmd.company_id=h.company_id
      AND start_cmd.id=(stop.payload->'__nativeBootstrapPrelaunchCleanup'->'owner'->>'startCommandId')::uuid
    JOIN public.activity_log stop_claim ON stop_claim.company_id=h.company_id
      AND stop_claim.entity_type='runtime_sandbox' AND stop_claim.entity_id=b.id::text
      AND stop_claim.action='sandbox.workload_stop_claimed'
      AND stop_claim.actor_type='system' AND stop_claim.actor_id='native-bootstrap-cleanup'
      AND stop_claim.details->>'runId'=h.id::text AND stop_claim.details->>'leaseId'=l.id::text
      AND stop_claim.details->>'stopClaimKey'='native-bootstrap-prelaunch-stop-claim:v1:'||encode(sha256(convert_to(public.aw_native_canonical_jsonb(stop.payload->'__nativeBootstrapPrelaunchCleanup'->'owner'),'UTF8')),'hex')
      AND stop_claim.details->>'idempotencyKey'=stop_claim.details->>'stopClaimKey'
      AND stop_claim.details->>'originalRequesterUserId' IS NOT NULL
    JOIN public.activity_log original_claim ON original_claim.company_id=h.company_id
      AND original_claim.entity_type='runtime_sandbox' AND original_claim.entity_id=b.id::text
      AND original_claim.action='sandbox.admission_claimed'
      AND original_claim.details->>'claimKey'=o.desired_state->>'claimKey'
      AND original_claim.details->>'generation'=o.desired_state->>'generation'
      AND original_claim.details->>'policySnapshotId'=o.desired_state->>'policySnapshotId'
      AND original_claim.details->>'executionManifestId'=o.desired_state->>'executionManifestId'
      AND original_claim.details->>'executionManifestHash'=o.desired_state->>'executionManifestHash'
      AND original_claim.details->>'policyHash'=o.desired_state->>'policyHash'
    WHERE h.company_id=target_company AND h.id=target_run AND h.runtime_mode='native'
      AND h.status='failed' AND h.native_phase='terminal_failure'
      AND h.error_code='provider_initialize_protocol_error' AND h.native_input_source_protocol_version=0
      AND h.finished_at IS NOT NULL AND h.native_process_cleanup_pending IS NULL
      AND h.process_pid IS NULL AND h.process_group_id IS NULL AND h.process_started_at IS NULL
      AND h.session_id_after IS NULL
      AND (f.issue_id IS NOT NULL) AND f.attempt=3 AND f.phase='terminal_failure'
      AND f.failure_code='native_session_retry_exhausted' AND f.recovery_state='blocked'
      AND f.lease_owner IS NULL AND f.lease_expires_at IS NULL AND f.next_attempt_at IS NULL
      AND f.result_id IS NULL AND f.assessment_id IS NULL AND f.decision_id IS NULL
      AND f.failure_detail->>'originalFailureCode'='provider_initialize_protocol_error'
      AND f.failure_detail->>'recoveryMode'='bootstrap_retry'
      AND f.failure_detail->'providerSessionEstablished'='false'::jsonb
      AND f.failure_detail->'providerEventsExist'='false'::jsonb
      AND f.failure_detail->'checkpointExists'='false'::jsonb
      AND h.native_issue_id=f.issue_id
      AND h.context_snapshot->>'issueId'=f.issue_id::text
      AND h.runner_profile_json->'nativeExecutionInput'->'binding'->>'companyId'=h.company_id::text
      AND h.runner_profile_json->'nativeExecutionInput'->'binding'->>'runId'=h.id::text
      AND h.runner_profile_json->'nativeExecutionInput'->'binding'->>'agentId'=h.agent_id::text
      AND h.runner_profile_json->'nativeExecutionInput'->'binding'->>'issueId'=f.issue_id::text
      AND h.runner_profile_json->'nativeExecutionInput'->'session'->>'normalizedSessionId'=h.native_session_id::text
      AND encode(sha256(convert_to(public.aw_native_canonical_jsonb(h.runner_profile_json->'nativeExecutionInput'),'UTF8')),'hex')=
        stop.payload->'__nativeBootstrapPrelaunchCleanup'->'owner'->>'executionInputHash'
      AND h.runner_profile_json->'nativeRemoteRuntimeAssetLocator'->>'schema'='paperclip.remote-runtime-asset-locator.v1'
      AND h.runner_profile_json->'nativeRemoteRuntimeAssetLocator'->>'companyId'=h.company_id::text
      AND h.runner_profile_json->'nativeRemoteRuntimeAssetLocator'->>'runId'=h.id::text
      AND h.runner_profile_json->'nativeRemoteRuntimeAssetLocator'->>'environmentId'=l.environment_id::text
      AND h.runner_profile_json->'nativeRemoteRuntimeAssetLocator'->>'environmentLeaseId'=l.id::text
      AND h.runner_profile_json->'nativeRemoteRuntimeAssetLocator'->>'provider'=l.provider
      AND h.runner_profile_json->'nativeRemoteRuntimeAssetLocator'->>'providerLeaseId'=l.provider_lease_id
      AND h.runner_profile_json->'nativeRemoteRuntimeAssetLocator'->>'runnerInstanceId'=h.runner_instance_id::text
      AND encode(sha256(convert_to(public.aw_native_canonical_jsonb(h.runner_profile_json->'nativeRemoteRuntimeAssetLocator'),'UTF8')),'hex')=
        stop.payload->'__nativeBootstrapPrelaunchCleanup'->'owner'->>'locatorDigest'
      AND encode(sha256(convert_to(h.native_session_id::text,'UTF8')),'hex')=
        h.runner_profile_json->'nativeRemoteRuntimeAssetLocator'->>'normalizedSessionIdDigest'
      AND h.runner_profile_json->'nativeRemoteRuntimeAssetLocator'->>'remoteCwdDigest'=
        encode(sha256(convert_to(btrim(l.metadata->>'remoteCwd'),'UTF8')),'hex')
      AND COALESCE(h.runner_profile_json->'sessionCheckpoint','null'::jsonb)='null'::jsonb
      AND COALESCE(h.runner_profile_json->'nativeProviderSessionReceipt','null'::jsonb)='null'::jsonb
      AND COALESCE(h.runner_profile_json->'nativeInputSourceReceipt','null'::jsonb)='null'::jsonb
      AND (NOT (h.runner_profile_json ? 'nativeModelInputDispatchIntents') OR
        (jsonb_typeof(h.runner_profile_json->'nativeModelInputDispatchIntents')='array' AND jsonb_array_length(h.runner_profile_json->'nativeModelInputDispatchIntents')=0))
      AND (NOT (h.runner_profile_json ? 'nativeToolCallDispatchAssociations') OR
        (jsonb_typeof(h.runner_profile_json->'nativeToolCallDispatchAssociations')='array' AND jsonb_array_length(h.runner_profile_json->'nativeToolCallDispatchAssociations')=0))
      AND (NOT (h.runner_profile_json ? 'nativeToolResultSourceCaptures') OR
        (jsonb_typeof(h.runner_profile_json->'nativeToolResultSourceCaptures')='array' AND jsonb_array_length(h.runner_profile_json->'nativeToolResultSourceCaptures')=0))
      AND (NOT (h.runner_profile_json ? 'nativeDocumentToolResultSources') OR
        (jsonb_typeof(h.runner_profile_json->'nativeDocumentToolResultSources')='array' AND jsonb_array_length(h.runner_profile_json->'nativeDocumentToolResultSources')=0))
      AND (NOT (h.runner_profile_json ? 'nativeAwModelWireIntents') OR
        (jsonb_typeof(h.runner_profile_json->'nativeAwModelWireIntents')='array' AND jsonb_array_length(h.runner_profile_json->'nativeAwModelWireIntents')=0))
      AND (NOT (h.runner_profile_json ? 'nativeRuntimeProcedureReadObservations') OR
        (jsonb_typeof(h.runner_profile_json->'nativeRuntimeProcedureReadObservations')='array' AND jsonb_array_length(h.runner_profile_json->'nativeRuntimeProcedureReadObservations')=0))
      AND NOT EXISTS (SELECT 1 FROM public.heartbeat_run_events e WHERE e.company_id=h.company_id AND e.run_id=h.id
        AND e.event_type=ANY(ARRAY['native.process_start_requested','native.process_identity_recorded','native.local_process_stopped',
          'native.in_process_backend_admitted','native.in_process_backend_settled','native.remote_workload_stopped',
          'native.session_start_intent','native.process_start_intent','native.model_dispatch_started','native.tool_invocation_started',
          'session.started','session.resumed','session.updated','session.reconciled','harness.ready','provider.event','provider.rpc_result',
          'turn.started','native.model_input_dispatch_intent','tool.execution.started']))
      AND NOT EXISTS (SELECT 1 FROM public.native_run_results r WHERE r.company_id=h.company_id AND r.run_id=h.id)
      AND NOT EXISTS (SELECT 1 FROM public.tool_invocations t WHERE t.company_id=h.company_id AND t.run_id=h.id)
      AND NOT EXISTS (SELECT 1 FROM public.orchestration_model_reservations mr WHERE mr.company_id=h.company_id
        AND (mr.conversation_run_id=h.id OR mr.worker_attempt_id IN
          (SELECT wa.id FROM public.orchestration_worker_attempts wa WHERE wa.company_id=h.company_id AND wa.run_id=h.id)))
      AND o.operation_type='stop' AND o.status='SUCCEEDED' AND o.completed_at IS NOT NULL
      AND o.requested_by_type='system' AND o.requested_by_id='native-bootstrap-cleanup'
      AND o.idempotency_key='native-bootstrap-cleanup:'||h.id::text||':'||l.id::text||':'||stop.id::text
      AND o.desired_state->>'sandboxAdmission'='true'
      AND o.desired_state->>'generation'=b.cell_generation::text
      AND o.desired_state->>'sandboxBindingId'=b.id::text
      AND o.desired_state->>'claimKey'=original_claim.details->>'claimKey'
      AND o.desired_state->>'sandboxHostCommandId'=stop.id::text
      AND o.desired_state->>'policySnapshotId'=original_claim.details->>'policySnapshotId'
      AND o.desired_state->>'executionManifestId'=original_claim.details->>'executionManifestId'
      AND o.desired_state->>'executionManifestHash'=original_claim.details->>'executionManifestHash'
      AND o.desired_state->>'policyHash'=original_claim.details->>'policyHash'
      AND (o.desired_state->'nativeBootstrapPrelaunchCleanup')->>'companyId'=h.company_id::text
      AND (o.desired_state->'nativeBootstrapPrelaunchCleanup')->>'runId'=h.id::text
      AND (o.desired_state->'nativeBootstrapPrelaunchCleanup')->>'leaseId'=l.id::text
      AND (o.desired_state->'nativeBootstrapPrelaunchCleanup')->>'ownerDigest' ~ '^[a-f0-9]{64}$'
      AND (o.desired_state->'nativeBootstrapPrelaunchCleanup')->>'physicalReceiptDigest' ~ '^[a-f0-9]{64}$'
      AND encode(sha256(convert_to(public.aw_native_canonical_jsonb(o.desired_state->'nativeBootstrapPrelaunchCleanup'->'physicalReceipt'),'UTF8')),'hex')=
        (o.desired_state->'nativeBootstrapPrelaunchCleanup')->>'physicalReceiptDigest'
      AND (o.desired_state->'nativeBootstrapPrelaunchCleanup'->'physicalReceipt')-ARRAY['schema','executionKind','companyId','runId','leaseId','provider','providerLeaseId','state','confirmedAt','prelaunchStop']='{}'::jsonb
      AND o.desired_state->'nativeBootstrapPrelaunchCleanup'->'physicalReceipt'->>'schema'='paperclip.remote-termination.v1'
      AND o.desired_state->'nativeBootstrapPrelaunchCleanup'->'physicalReceipt'->>'executionKind'='native_bootstrap_prelaunch'
      AND o.desired_state->'nativeBootstrapPrelaunchCleanup'->'physicalReceipt'->>'companyId'=h.company_id::text
      AND o.desired_state->'nativeBootstrapPrelaunchCleanup'->'physicalReceipt'->>'runId'=h.id::text
      AND o.desired_state->'nativeBootstrapPrelaunchCleanup'->'physicalReceipt'->>'leaseId'=l.id::text
      AND o.desired_state->'nativeBootstrapPrelaunchCleanup'->'physicalReceipt'->>'provider'=l.provider
      AND o.desired_state->'nativeBootstrapPrelaunchCleanup'->'physicalReceipt'->>'providerLeaseId'=l.provider_lease_id
      AND o.desired_state->'nativeBootstrapPrelaunchCleanup'->'physicalReceipt'->>'state'='stopped'
      AND (o.desired_state->'nativeBootstrapPrelaunchCleanup'->'physicalReceipt'->>'confirmedAt')::timestamptz=inspect.completed_at
      AND (o.desired_state->'nativeBootstrapPrelaunchCleanup'->'physicalReceipt'->'prelaunchStop')-ARRAY['owner','scope','stopCommandId','inspectCommandId']='{}'::jsonb
      AND o.desired_state->'nativeBootstrapPrelaunchCleanup'->'physicalReceipt'->'prelaunchStop'->'owner'=
        stop.payload->'__nativeBootstrapPrelaunchCleanup'->'owner'
      AND o.desired_state->'nativeBootstrapPrelaunchCleanup'->'physicalReceipt'->'prelaunchStop'->'scope'=stop.payload->'scope'
      AND o.desired_state->'nativeBootstrapPrelaunchCleanup'->'physicalReceipt'->'prelaunchStop'->>'stopCommandId'=stop.id::text
      AND o.desired_state->'nativeBootstrapPrelaunchCleanup'->'physicalReceipt'->'prelaunchStop'->>'inspectCommandId'=inspect.id::text
      AND (o.desired_state->'nativeBootstrapPrelaunchCleanup')->>'stopCommandId'=stop.id::text
      AND (o.desired_state->'nativeBootstrapPrelaunchCleanup')->>'inspectCommandId'=inspect.id::text
      AND l.status IN ('released','expired') AND l.released_at IS NOT NULL AND l.cleanup_status='success'
      AND l.provider<>'local' AND l.metadata->>'remoteCwd' IS NOT NULL AND l.metadata->>'remoteCwd'=btrim(l.metadata->>'remoteCwd')
      AND left(l.metadata->>'remoteCwd',1)='/'
      AND l.id=(o.desired_state->'nativeBootstrapPrelaunchCleanup'->>'leaseId')::uuid
      AND b.backend='openshell' AND b.status='stopped'
      AND host.credential_version=(stop.payload->>'hostEpoch')::integer
      AND host.credential_revoked_at IS NULL AND host.fenced_at IS NULL AND host.retired_at IS NULL
      AND COALESCE(c.active_image_digest,c.desired_image_digest)=stop.payload->>'imageDigest'
      AND stop.payload->'scope'->>'sandboxRef'=COALESCE(b.sandbox_ref,'aw-v7-'||b.id::text)
      AND manifest.hash=o.desired_state->>'executionManifestHash'
      AND manifest.manifest->>'responsibleUserId'=h.responsible_user_id
      AND policy.policy_hash=o.desired_state->>'policyHash'
      AND policy.status='revoked'
      AND NOT EXISTS (SELECT 1 FROM public.runtime_policy_snapshots unrevoked WHERE unrevoked.company_id=h.company_id
        AND unrevoked.binding_id=b.id AND unrevoked.status IN ('draft','qualified'))
      AND b.version=(original_claim.details->>'claimVersion')::bigint+3
      AND c.status='STOPPED' AND c.deleted_at IS NULL AND c.runtime_host_id=stop.runtime_host_id
      AND stop.command_type='v7_openshell_rpc' AND stop.status='SUCCEEDED' AND stop.completed_at IS NOT NULL
      AND stop.runtime_cell_id=c.id AND stop.cell_generation=c.generation
      AND stop.payload->'__nativeBootstrapPrelaunchCleanup'->'owner'->>'version'='1'
      AND stop.payload->'__nativeBootstrapPrelaunchCleanup'->'owner'->>'companyId'=h.company_id::text
      AND stop.payload->'__nativeBootstrapPrelaunchCleanup'->'owner'->>'runId'=h.id::text
      AND stop.payload->'__nativeBootstrapPrelaunchCleanup'->'owner'->>'leaseId'=l.id::text
      AND stop.payload->'__nativeBootstrapPrelaunchCleanup'->'owner'->>'attempt'='3'
      AND stop.payload->'__nativeBootstrapPrelaunchCleanup'->'owner'->>'bindingId'=b.id::text
      AND stop.payload->'__nativeBootstrapPrelaunchCleanup'->'owner'->>'cellId'=c.id::text
      AND stop.payload->'__nativeBootstrapPrelaunchCleanup'->'owner'->>'generation'=b.cell_generation::text
      AND stop.payload->'__nativeBootstrapPrelaunchCleanup'->'owner'->>'hostId'=c.runtime_host_id::text
      AND stop.payload->'__nativeBootstrapPrelaunchCleanup'->'owner'->>'claimKey'=original_claim.details->>'claimKey'
      AND stop.payload->'__nativeBootstrapPrelaunchCleanup'->'owner'->>'claimVersion'=(original_claim.details->>'claimVersion')
      AND stop.payload->'__nativeBootstrapPrelaunchCleanup'->'owner'->>'policySnapshotId'=original_claim.details->>'policySnapshotId'
      AND stop.payload->'__nativeBootstrapPrelaunchCleanup'->'owner'->>'policyHash'=original_claim.details->>'policyHash'
      AND stop.payload->'__nativeBootstrapPrelaunchCleanup'->'owner'->>'manifestId'=original_claim.details->>'executionManifestId'
      AND stop.payload->'__nativeBootstrapPrelaunchCleanup'->'owner'->>'manifestHash'=original_claim.details->>'executionManifestHash'
      AND stop.payload->'__nativeBootstrapPrelaunchCleanup'->'owner'->>'requesterUserId'=original_claim.actor_id
      AND stop.payload->'__nativeBootstrapPrelaunchCleanup'->'owner'->>'sandboxId'=stop.payload->'expectedTarget'->>'sandboxId'
      AND stop.payload->'__nativeBootstrapPrelaunchCleanup'->'owner'->>'containerId'=stop.payload->'expectedTarget'->>'containerId'
      AND stop.payload->'__nativeBootstrapPrelaunchCleanup'->'owner'->>'prepareCommandId'=prep.id::text
      AND stop.payload->'__nativeBootstrapPrelaunchCleanup'->'owner'->>'applyCommandId'=apply_cmd.id::text
      AND stop.payload->'__nativeBootstrapPrelaunchCleanup'->'owner'->>'startCommandId'=start_cmd.id::text
      AND prep.command_type='v7_openshell_rpc' AND prep.status='SUCCEEDED' AND prep.completed_at IS NOT NULL
      AND prep.runtime_host_id=stop.runtime_host_id AND prep.runtime_cell_id=c.id AND prep.cell_generation=c.generation
      AND prep.payload->>'action'='prepare' AND prep.payload->'scope'=stop.payload->'scope'
      AND apply_cmd.command_type='v7_openshell_rpc' AND apply_cmd.status='SUCCEEDED' AND apply_cmd.completed_at IS NOT NULL
      AND apply_cmd.runtime_host_id=stop.runtime_host_id AND apply_cmd.runtime_cell_id=c.id AND apply_cmd.cell_generation=c.generation
      AND apply_cmd.payload->>'action'='apply' AND apply_cmd.payload->'scope'=stop.payload->'scope'
      AND start_cmd.command_type='v7_openshell_rpc' AND start_cmd.status='SUCCEEDED' AND start_cmd.completed_at IS NOT NULL
      AND start_cmd.runtime_host_id=stop.runtime_host_id AND start_cmd.runtime_cell_id=c.id AND start_cmd.cell_generation=c.generation
      AND start_cmd.payload->>'action'='start' AND start_cmd.payload->'scope'=stop.payload->'scope'
      AND prep.payload->>'requesterUserId'=original_claim.actor_id
      AND apply_cmd.payload->>'requesterUserId'=original_claim.actor_id
      AND start_cmd.payload->>'requesterUserId'=original_claim.actor_id
      AND start_cmd.safe_result->>'sandboxId'=stop.payload->'expectedTarget'->>'sandboxId'
      AND start_cmd.safe_result->>'containerId'=stop.payload->'expectedTarget'->>'containerId'
      AND start_cmd.safe_result->>'policyHash'=o.desired_state->>'policyHash'
      AND start_cmd.safe_result->>'imageDigest'=stop.payload->>'imageDigest'
      AND prep.payload->>'imageDigest'=stop.payload->>'imageDigest'
      AND apply_cmd.payload->>'imageDigest'=stop.payload->>'imageDigest'
      AND start_cmd.payload->>'imageDigest'=stop.payload->>'imageDigest'
      AND original_claim.actor_type='user'
      AND original_claim.actor_id=stop.payload->>'requesterUserId'
      AND original_claim.actor_id=h.responsible_user_id
      AND stop_claim.details->>'generation'=b.cell_generation::text
      AND stop_claim.details->>'claimKey'=original_claim.details->>'claimKey'
      AND stop_claim.details->>'policySnapshotId'=original_claim.details->>'policySnapshotId'
      AND stop_claim.details->>'originalRequesterUserId'=original_claim.actor_id
      AND stop_claim.details->>'stopClaimKey'='native-bootstrap-prelaunch-stop-claim:v1:'||encode(sha256(convert_to(public.aw_native_canonical_jsonb(stop.payload->'__nativeBootstrapPrelaunchCleanup'->'owner'),'UTF8')),'hex')
      AND (original_claim.details->>'claimVersion')::bigint=(original_claim.details->>'expectedVersion')::bigint+1
      AND original_claim.details->>'claimKey'='v7-sandbox-admission:'||b.id::text||':'||b.cell_generation::text||':'||
        ((original_claim.details->>'expectedVersion')::bigint)::text||':'||(original_claim.details->>'policySnapshotId')
      AND (original_claim.details->>'claimVersion')::bigint=(original_claim.details->>'expectedVersion')::bigint+1
      AND stop.payload->>'action'='stop' AND stop.safe_result->>'action'='stop' AND stop.safe_result->'stopped'='true'::jsonb
      AND stop.payload->'scope'->>'companyId'=h.company_id::text
      AND stop.payload->'scope'->>'bindingId'=b.id::text AND stop.payload->'scope'->>'cellId'=c.id::text
      AND stop.payload->'scope'->>'cellGeneration'=b.cell_generation::text
      AND stop.payload->>'requesterUserId'=original_claim.actor_id
      AND stop.payload->>'hostEpoch'=stop.payload->'__nativeBootstrapPrelaunchCleanup'->'owner'->>'hostEpoch'
      AND stop.payload->'expectedTarget'->>'sandboxId'=stop.payload->'__nativeBootstrapPrelaunchCleanup'->'owner'->>'sandboxId'
      AND stop.payload->'expectedTarget'->>'containerId'=stop.payload->'__nativeBootstrapPrelaunchCleanup'->'owner'->>'containerId'
      AND stop.payload->'__nativeBootstrapPrelaunchCleanup'->>'version'='1'
      AND stop.payload->'__nativeBootstrapPrelaunchCleanup'->'owner' IS NOT NULL
      AND encode(sha256(convert_to(public.aw_native_canonical_jsonb(stop.payload->'__nativeBootstrapPrelaunchCleanup'->'owner'),'UTF8')),'hex')=
        (o.desired_state->'nativeBootstrapPrelaunchCleanup')->>'ownerDigest'
      AND inspect.command_type='v7_openshell_rpc' AND inspect.status='SUCCEEDED' AND inspect.completed_at IS NOT NULL
      AND inspect.runtime_host_id=stop.runtime_host_id AND inspect.runtime_cell_id=c.id AND inspect.cell_generation=c.generation
      AND inspect.created_at>=stop.completed_at AND inspect.payload->>'action'='inspect'
      AND inspect.payload->'scope'=stop.payload->'scope'
      AND inspect.payload->>'imageDigest'=stop.payload->>'imageDigest'
      AND inspect.payload->>'requesterUserId'=stop.payload->>'requesterUserId'
      AND inspect.payload->>'hostEpoch'=stop.payload->>'hostEpoch'
      AND inspect.payload->'expectedTarget'=stop.payload->'expectedTarget'
      AND inspect.payload->'__nativeBootstrapPrelaunchCleanup'=stop.payload->'__nativeBootstrapPrelaunchCleanup'
      AND inspect.safe_result->>'action'='inspect' AND inspect.safe_result->>'state'='stopped'
      AND inspect.safe_result->>'sandboxId'=stop.payload->'expectedTarget'->>'sandboxId'
      AND inspect.safe_result->>'containerId'=stop.payload->'expectedTarget'->>'containerId'
      AND inspect.safe_result->>'generation'=b.cell_generation::text
      AND inspect.safe_result->>'imageDigest'=stop.payload->>'imageDigest'
      AND inspect.safe_result->>'policyHash'=original_claim.details->>'policyHash'
      AND NOT EXISTS (SELECT 1 FROM public.environment_leases sibling WHERE sibling.company_id=l.company_id
        AND sibling.heartbeat_run_id=h.id AND sibling.id<>l.id
        AND sibling.environment_id IS NOT DISTINCT FROM l.environment_id)
      AND NOT EXISTS (SELECT 1 FROM public.environment_leases foreign_lease WHERE foreign_lease.company_id=l.company_id
        AND foreign_lease.provider=l.provider AND foreign_lease.id<>l.id
        AND foreign_lease.status IN ('active','pending_cleanup')
        AND ((l.provider_lease_id IS NOT NULL AND foreign_lease.provider_lease_id=l.provider_lease_id)
          OR (l.metadata->>'remoteCwd' IS NOT NULL AND foreign_lease.metadata->>'remoteCwd'=l.metadata->>'remoteCwd')))
      AND (SELECT count(*) FROM public.activity_log claim_count WHERE claim_count.company_id=h.company_id
        AND claim_count.entity_type='runtime_sandbox' AND claim_count.entity_id=b.id::text
        AND claim_count.action='sandbox.admission_claimed'
        AND claim_count.details->>'generation'=b.cell_generation::text)=1
      AND NOT EXISTS (SELECT 1 FROM public.activity_log successor_claim WHERE successor_claim.company_id=h.company_id
        AND successor_claim.entity_type='runtime_sandbox' AND successor_claim.entity_id=b.id::text
        AND successor_claim.action='sandbox.admission_claimed' AND successor_claim.id<>original_claim.id
        AND successor_claim.details->>'generation'=b.cell_generation::text)
      AND NOT EXISTS (SELECT 1 FROM public.runtime_host_commands hc WHERE hc.company_id=h.company_id
        AND hc.runtime_host_id=stop.runtime_host_id AND hc.runtime_cell_id=c.id AND hc.cell_generation=c.generation
        AND hc.command_type='v7_openshell_rpc'
        AND NOT COALESCE((hc.id IN (prep.id,apply_cmd.id,start_cmd.id,stop.id,inspect.id)
          OR (hc.created_at<prep.created_at AND hc.status='SUCCEEDED' AND hc.completed_at IS NOT NULL)
          OR (hc.created_at>=prep.created_at AND hc.status='SUCCEEDED' AND hc.completed_at IS NOT NULL
            AND hc.payload->>'action' IN ('capabilities','inspect','effective_policy','prove_policy')
            AND hc.payload->'scope'=stop.payload->'scope'
            AND hc.payload->>'hostEpoch'=stop.payload->>'hostEpoch'
            AND hc.payload->>'imageDigest'=stop.payload->>'imageDigest'
            AND hc.payload->>'requesterUserId'=stop.payload->>'requesterUserId'
            AND hc.safe_result->>'action'=hc.payload->>'action'
            AND (hc.payload->>'action'<>'inspect' OR (
              hc.safe_result->>'generation'=b.cell_generation
              AND (hc.safe_result->>'imageDigest' IS NULL OR hc.safe_result->>'imageDigest'=stop.payload->>'imageDigest')
              AND (hc.payload->'expectedTarget' IS NULL OR (
                hc.payload->'expectedTarget'=stop.payload->'expectedTarget'
                AND hc.safe_result->>'sandboxId'=stop.payload->'expectedTarget'->>'sandboxId'
                AND hc.safe_result->>'containerId'=stop.payload->'expectedTarget'->>'containerId'))))
            AND (hc.payload->>'action'<>'prove_policy' OR (
              hc.payload->'policyProof'->>'sandboxId'=stop.payload->'expectedTarget'->>'sandboxId'
              AND hc.payload->'policyProof'->>'containerId'=stop.payload->'expectedTarget'->>'containerId'
              AND hc.safe_result->'target'->>'sandboxId'=stop.payload->'expectedTarget'->>'sandboxId'
              AND hc.safe_result->'target'->>'containerId'=stop.payload->'expectedTarget'->>'containerId')))), false))
      AND NOT EXISTS (SELECT 1 FROM public.runtime_host_commands successor WHERE successor.company_id=h.company_id
        AND successor.runtime_host_id=stop.runtime_host_id AND successor.runtime_cell_id=c.id
        AND successor.cell_generation=c.generation AND successor.created_at>o.completed_at)
      AND NOT EXISTS (SELECT 1 FROM public.runtime_operations successor_op WHERE successor_op.company_id=h.company_id
        AND successor_op.runtime_cell_id=c.id AND successor_op.id<>o.id
        AND (successor_op.completed_at IS NULL OR successor_op.completed_at>o.completed_at
          OR successor_op.status IN ('REQUESTED','RUNNING','WAITING_FOR_CAPACITY','NEEDS_RECONCILIATION')))
      AND NOT EXISTS (SELECT 1 FROM public.runtime_host_commands foreign_exec WHERE foreign_exec.company_id=h.company_id
        AND foreign_exec.command_type='sandbox_exec' AND foreign_exec.runtime_host_id=stop.runtime_host_id
        AND foreign_exec.runtime_cell_id=c.id AND foreign_exec.cell_generation=c.generation
        AND (foreign_exec.payload->>'runId' IS DISTINCT FROM h.id::text OR foreign_exec.payload->>'leaseId' IS DISTINCT FROM l.id::text)
        AND NOT COALESCE((foreign_exec.status='SUCCEEDED' AND foreign_exec.completed_at < start_cmd.created_at),false))
      AND (SELECT count(*) FROM public.runtime_host_commands setup_count WHERE setup_count.company_id=h.company_id
        AND setup_count.payload->>'runId'=h.id::text AND setup_count.payload->>'leaseId'=l.id::text) BETWEEN 1 AND 64
      AND (SELECT count(*) FROM public.runtime_host_commands host_scope_count WHERE host_scope_count.company_id=h.company_id
        AND host_scope_count.runtime_host_id=stop.runtime_host_id AND host_scope_count.runtime_cell_id=c.id
        AND host_scope_count.cell_generation=c.generation AND host_scope_count.command_type='v7_openshell_rpc')<=256
      AND NOT EXISTS (SELECT 1 FROM public.runtime_host_commands invalid_setup WHERE invalid_setup.company_id=h.company_id
        AND invalid_setup.command_type='sandbox_exec' AND invalid_setup.payload->>'runId'=h.id::text
        AND invalid_setup.payload->>'leaseId'=l.id::text
        AND (invalid_setup.status<>'SUCCEEDED' OR invalid_setup.completed_at IS NULL
          OR invalid_setup.runtime_host_id IS DISTINCT FROM c.runtime_host_id
          OR invalid_setup.runtime_cell_id IS DISTINCT FROM c.id
          OR invalid_setup.cell_generation IS DISTINCT FROM c.generation
          OR invalid_setup.payload->>'hostId' IS DISTINCT FROM c.runtime_host_id::text
          OR invalid_setup.payload->>'cellId' IS DISTINCT FROM c.id::text
          OR invalid_setup.payload->>'generation' IS DISTINCT FROM b.cell_generation
          OR invalid_setup.payload->>'bindingId' IS DISTINCT FROM b.id::text
          OR invalid_setup.payload->>'requestId' IS DISTINCT FROM invalid_setup.idempotency_key
          OR invalid_setup.payload->>'kind' IS DISTINCT FROM 'sandbox_exec_v1'
          OR invalid_setup.payload->>'commandDigest' IS NULL
          OR invalid_setup.payload->>'commandDigest' !~ '^[a-f0-9]{64}$'
          OR invalid_setup.payload->>'nativePreparationPurpose' IS NULL
          OR invalid_setup.payload->>'nativePreparationPurpose' NOT IN
            ('provider_artifact','native_workspace_prepare','native_runtime_context_prepare','native_harness_state','native_attachment_stage','native_attachment_cleanup')
          OR invalid_setup.payload->>'manifestId' IS DISTINCT FROM manifest.id::text
          OR invalid_setup.payload->>'manifestHash' IS DISTINCT FROM manifest.hash
          OR invalid_setup.payload->>'policySnapshotId' IS DISTINCT FROM policy.id::text
          OR invalid_setup.payload->>'policyHash' IS DISTINCT FROM policy.policy_hash
          OR invalid_setup.safe_result ? 'modelBrokerSessionReceipt'
          OR invalid_setup.safe_result->'timedOut' IS DISTINCT FROM 'false'::jsonb
          OR jsonb_typeof(invalid_setup.safe_result->'exitCode') IS DISTINCT FROM 'number'
          OR invalid_setup.safe_result->>'exitCode' !~ '^-?(0|[1-9][0-9]{0,15})$'
          OR abs((invalid_setup.safe_result->>'exitCode')::numeric)>9007199254740991
          OR invalid_setup.payload ? 'modelBrokerSession' OR invalid_setup.payload ? 'modelBrokerSessionPhase'
          OR invalid_setup.payload ? 'modelBrokerCredential' OR invalid_setup.payload ? 'modelBrokerCapability'
          OR invalid_setup.payload ? 'brokerCredential'))
  ), false);
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;
--> statement-breakpoint
-- Guard the only marker used by the derived settlement. Generic runtime Stop
-- APIs cannot mint this owner or add it to desired_state; it is produced by
-- the private Native bootstrap cleanup bridge after its signed verifier.
CREATE OR REPLACE FUNCTION public.aw_v10_prelaunch_cleanup_operation_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE p jsonb;
BEGIN
 p:=NEW.desired_state->'nativeBootstrapPrelaunchCleanup';
 IF TG_OP='UPDATE' AND OLD.desired_state ? 'nativeBootstrapPrelaunchCleanup' THEN
   IF NOT (NEW.desired_state ? 'nativeBootstrapPrelaunchCleanup') THEN
     RAISE EXCEPTION 'native_prelaunch_cleanup_operation_owner_is_immutable' USING ERRCODE='23514';
   END IF;
   IF NEW.id IS DISTINCT FROM OLD.id OR NEW.company_id IS DISTINCT FROM OLD.company_id OR
      NEW.runtime_cell_id IS DISTINCT FROM OLD.runtime_cell_id OR NEW.operation_type IS DISTINCT FROM OLD.operation_type OR
      NEW.status IS DISTINCT FROM OLD.status OR NEW.requested_by_type IS DISTINCT FROM OLD.requested_by_type OR
      NEW.requested_by_id IS DISTINCT FROM OLD.requested_by_id OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR
      NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.completed_at IS DISTINCT FROM OLD.completed_at OR
      NEW.desired_state IS DISTINCT FROM OLD.desired_state THEN
     RAISE EXCEPTION 'native_prelaunch_cleanup_operation_owner_is_immutable' USING ERRCODE='23514';
   END IF;
   RETURN NEW;
 END IF;
 IF p IS NULL THEN RETURN NEW; END IF;
 IF jsonb_typeof(p) IS DISTINCT FROM 'object'
   OR p-ARRAY['companyId','runId','leaseId','ownerDigest','physicalReceiptDigest','physicalReceipt','stopCommandId','inspectCommandId']<>'{}'::jsonb
   OR p->>'companyId' IS DISTINCT FROM NEW.company_id::text
   OR p->>'stopCommandId' IS DISTINCT FROM NEW.desired_state->>'sandboxHostCommandId'
   OR p->>'runId' IS DISTINCT FROM p->'physicalReceipt'->>'runId'
   OR p->>'leaseId' IS DISTINCT FROM p->'physicalReceipt'->>'leaseId'
   OR p->'physicalReceipt'->>'companyId' IS DISTINCT FROM NEW.company_id::text
   OR p->'physicalReceipt'->>'schema' IS DISTINCT FROM 'paperclip.remote-termination.v1'
   OR p->'physicalReceipt'->>'executionKind' IS DISTINCT FROM 'native_bootstrap_prelaunch'
   OR p->'physicalReceipt'->>'state' IS DISTINCT FROM 'stopped'
   OR p->'physicalReceipt'->'prelaunchStop'->>'stopCommandId' IS DISTINCT FROM p->>'stopCommandId'
   OR p->'physicalReceipt'->'prelaunchStop'->>'inspectCommandId' IS DISTINCT FROM p->>'inspectCommandId'
   OR p->'physicalReceipt'->'prelaunchStop'->'owner' IS NULL
   OR p->'physicalReceipt'->'prelaunchStop'->'owner'->>'companyId' IS DISTINCT FROM NEW.company_id::text
   OR p->'physicalReceipt'->'prelaunchStop'->'owner'->>'runId' IS DISTINCT FROM p->>'runId'
   OR p->'physicalReceipt'->'prelaunchStop'->'owner'->>'leaseId' IS DISTINCT FROM p->>'leaseId'
   OR encode(sha256(convert_to(public.aw_native_canonical_jsonb(p->'physicalReceipt'->'prelaunchStop'->'owner'),'UTF8')),'hex') IS DISTINCT FROM p->>'ownerDigest'
   OR NEW.desired_state->>'sandboxBindingId' IS DISTINCT FROM p->'physicalReceipt'->'prelaunchStop'->'owner'->>'bindingId'
   OR NEW.desired_state->>'generation' IS DISTINCT FROM p->'physicalReceipt'->'prelaunchStop'->'owner'->>'generation'
   OR NEW.desired_state->>'claimKey' IS DISTINCT FROM p->'physicalReceipt'->'prelaunchStop'->'owner'->>'claimKey'
   OR NEW.desired_state->>'policySnapshotId' IS DISTINCT FROM p->'physicalReceipt'->'prelaunchStop'->'owner'->>'policySnapshotId'
   OR NEW.desired_state->>'executionManifestId' IS DISTINCT FROM p->'physicalReceipt'->'prelaunchStop'->'owner'->>'manifestId'
   OR NEW.desired_state->>'executionManifestHash' IS DISTINCT FROM p->'physicalReceipt'->'prelaunchStop'->'owner'->>'manifestHash'
   OR NEW.desired_state->>'policyHash' IS DISTINCT FROM p->'physicalReceipt'->'prelaunchStop'->'owner'->>'policyHash'
   OR NEW.idempotency_key IS DISTINCT FROM ('native-bootstrap-cleanup:'||(p->>'runId')||':'||(p->>'leaseId')||':'||(p->>'stopCommandId'))
   OR p->>'ownerDigest' !~ '^[a-f0-9]{64}$'
   OR p->>'physicalReceiptDigest' !~ '^[a-f0-9]{64}$'
   OR encode(sha256(convert_to(public.aw_native_canonical_jsonb(p->'physicalReceipt'),'UTF8')),'hex') IS DISTINCT FROM p->>'physicalReceiptDigest'
   OR p->>'runId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   OR p->>'leaseId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   OR p->>'stopCommandId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   OR p->>'inspectCommandId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   OR NEW.operation_type<>'stop' OR NEW.status<>'SUCCEEDED' OR NEW.requested_by_type<>'system'
   OR NEW.requested_by_id<>'native-bootstrap-cleanup'
   OR NEW.desired_state->>'sandboxBindingId' IS NULL OR NEW.desired_state->>'generation' IS NULL
   OR NOT EXISTS (SELECT 1 FROM public.runtime_host_commands stop WHERE stop.company_id=NEW.company_id
      AND stop.id=(p->>'stopCommandId')::uuid AND stop.status='SUCCEEDED' AND stop.completed_at IS NOT NULL
      AND stop.command_type='v7_openshell_rpc' AND stop.payload->>'action'='stop'
      AND stop.payload->'__nativeBootstrapPrelaunchCleanup'->'owner' IS NOT NULL
      AND stop.runtime_cell_id=NEW.runtime_cell_id
      AND stop.payload->'__nativeBootstrapPrelaunchCleanup'->'owner'=p->'physicalReceipt'->'prelaunchStop'->'owner'
      AND stop.payload->'scope'=p->'physicalReceipt'->'prelaunchStop'->'scope'
      AND stop.payload->'scope'->>'companyId'=NEW.company_id::text
      AND stop.payload->'scope'->>'bindingId'=p->'physicalReceipt'->'prelaunchStop'->'owner'->>'bindingId'
      AND stop.payload->'scope'->>'cellId'=NEW.runtime_cell_id::text
      AND stop.payload->'scope'->>'cellGeneration'=p->'physicalReceipt'->'prelaunchStop'->'owner'->>'generation'
      AND stop.payload->>'hostEpoch'=p->'physicalReceipt'->'prelaunchStop'->'owner'->>'hostEpoch'
      AND stop.payload->>'imageDigest'=p->'physicalReceipt'->'prelaunchStop'->'owner'->>'imageDigest'
      AND stop.payload->>'requesterUserId'=p->'physicalReceipt'->'prelaunchStop'->'owner'->>'requesterUserId'
      AND stop.payload->'expectedTarget'->>'sandboxId'=p->'physicalReceipt'->'prelaunchStop'->'owner'->>'sandboxId'
      AND stop.payload->'expectedTarget'->>'containerId'=p->'physicalReceipt'->'prelaunchStop'->'owner'->>'containerId'
      AND stop.safe_result->>'action'='stop' AND stop.safe_result->'stopped'='true'::jsonb
      AND stop.safe_result->>'sandboxId'=p->'physicalReceipt'->'prelaunchStop'->'owner'->>'sandboxId'
      AND stop.safe_result->>'containerId'=p->'physicalReceipt'->'prelaunchStop'->'owner'->>'containerId'
      AND encode(sha256(convert_to(public.aw_native_canonical_jsonb(stop.payload->'__nativeBootstrapPrelaunchCleanup'->'owner'),'UTF8')),'hex')=p->>'ownerDigest')
   OR NOT EXISTS (SELECT 1 FROM public.runtime_host_commands inspect WHERE inspect.company_id=NEW.company_id
      AND inspect.id=(p->>'inspectCommandId')::uuid AND inspect.status='SUCCEEDED' AND inspect.completed_at IS NOT NULL
      AND inspect.command_type='v7_openshell_rpc' AND inspect.payload->>'action'='inspect'
      AND inspect.runtime_cell_id=NEW.runtime_cell_id AND inspect.runtime_host_id=(SELECT stop.runtime_host_id FROM public.runtime_host_commands stop WHERE stop.company_id=NEW.company_id AND stop.id=(p->>'stopCommandId')::uuid)
      AND inspect.cell_generation=(SELECT stop.cell_generation FROM public.runtime_host_commands stop WHERE stop.company_id=NEW.company_id AND stop.id=(p->>'stopCommandId')::uuid)
      AND inspect.created_at >= (SELECT stop.completed_at FROM public.runtime_host_commands stop WHERE stop.company_id=NEW.company_id AND stop.id=(p->>'stopCommandId')::uuid)
      AND inspect.payload->'scope'=(SELECT stop.payload->'scope' FROM public.runtime_host_commands stop WHERE stop.company_id=NEW.company_id AND stop.id=(p->>'stopCommandId')::uuid)
      AND inspect.payload->>'hostEpoch'=(SELECT stop.payload->>'hostEpoch' FROM public.runtime_host_commands stop WHERE stop.company_id=NEW.company_id AND stop.id=(p->>'stopCommandId')::uuid)
      AND inspect.payload->>'imageDigest'=(SELECT stop.payload->>'imageDigest' FROM public.runtime_host_commands stop WHERE stop.company_id=NEW.company_id AND stop.id=(p->>'stopCommandId')::uuid)
      AND inspect.payload->>'requesterUserId'=(SELECT stop.payload->>'requesterUserId' FROM public.runtime_host_commands stop WHERE stop.company_id=NEW.company_id AND stop.id=(p->>'stopCommandId')::uuid)
      AND inspect.payload->'expectedTarget'=(SELECT stop.payload->'expectedTarget' FROM public.runtime_host_commands stop WHERE stop.company_id=NEW.company_id AND stop.id=(p->>'stopCommandId')::uuid)
      AND inspect.safe_result->>'action'='inspect' AND inspect.safe_result->>'state'='stopped'
      AND inspect.safe_result->>'sandboxId'=p->'physicalReceipt'->'prelaunchStop'->'owner'->>'sandboxId'
      AND inspect.safe_result->>'containerId'=p->'physicalReceipt'->'prelaunchStop'->'owner'->>'containerId'
      AND inspect.safe_result->>'generation'=p->'physicalReceipt'->'prelaunchStop'->'owner'->>'generation'
      AND inspect.safe_result->>'imageDigest'=p->'physicalReceipt'->'prelaunchStop'->'owner'->>'imageDigest'
      AND inspect.safe_result->>'policyHash'=p->'physicalReceipt'->'prelaunchStop'->'owner'->>'policyHash'
      AND (p->'physicalReceipt'->>'confirmedAt')::timestamptz=inspect.completed_at
      AND inspect.payload->'__nativeBootstrapPrelaunchCleanup'=(SELECT stop.payload->'__nativeBootstrapPrelaunchCleanup'
         FROM public.runtime_host_commands stop WHERE stop.company_id=NEW.company_id AND stop.id=(p->>'stopCommandId')::uuid))
 THEN RAISE EXCEPTION 'native_prelaunch_cleanup_operation_requires_verified_private_owner' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER aw_v10_prelaunch_cleanup_operation_insert_guard
BEFORE INSERT ON public.runtime_operations
FOR EACH ROW EXECUTE FUNCTION public.aw_v10_prelaunch_cleanup_operation_guard();
--> statement-breakpoint
CREATE TRIGGER aw_v10_prelaunch_cleanup_operation_update_guard
BEFORE UPDATE OF id,company_id,runtime_cell_id,desired_state,operation_type,status,requested_by_type,requested_by_id,
  idempotency_key,created_at,completed_at ON public.runtime_operations
FOR EACH ROW EXECUTE FUNCTION public.aw_v10_prelaunch_cleanup_operation_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.aw_v10_resource_durable_occupancy(target_company uuid DEFAULT NULL)
RETURNS bigint LANGUAGE sql VOLATILE AS $$
 WITH run_candidates AS (
  SELECT company_id,id FROM heartbeat_runs WHERE status='running'
   AND (target_company IS NULL OR company_id=target_company)
  UNION SELECT company_id,id FROM heartbeat_runs WHERE runner_profile_json->>'nativeWorkspaceFinalizationOwner' IS NOT NULL
   AND (target_company IS NULL OR company_id=target_company)
  UNION SELECT company_id,id FROM heartbeat_runs WHERE
   (native_process_cleanup_pending IS TRUE OR (native_process_cleanup_pending IS NULL AND runtime_mode='native'
    AND (status<>'queued' OR started_at IS NOT NULL OR process_started_at IS NOT NULL OR process_pid IS NOT NULL
     OR process_group_id IS NOT NULL OR native_phase IS NOT NULL OR session_id_after IS NOT NULL)
    AND NOT public.aw_v10_native_prelaunch_container_cleanup_completed(company_id,id)))
   AND (target_company IS NULL OR company_id=target_company)
  UNION SELECT company_id,run_id FROM native_run_finalizations WHERE
   (lease_owner IS NOT NULL OR phase NOT IN ('committed','applied','terminal_failure')) AND (target_company IS NULL OR company_id=target_company)
 ), lease_candidates AS (
  SELECT l AS lease,h.runtime_mode FROM environment_leases l LEFT JOIN heartbeat_runs h ON h.id=l.heartbeat_run_id AND h.company_id=l.company_id
  WHERE (not coalesce(((l.status in ('released','expired','failed') and l.released_at is not null and
        (l.cleanup_status='success' or (l.cleanup_status is null and
          ((l.provider='local' and l.provider_lease_id is null) or
           (l.provider='ssh' and l.metadata->>'driver'='ssh' and l.provider_lease_id like 'ssh://%')))))
        or (l.status='retained' and l.lease_policy='reuse_by_environment' and l.cleanup_status='success')),false)
        or coalesce(l.metadata->>'pendingCleanupInFlight','false')<>'false') AND (target_company IS NULL OR l.company_id=target_company)
 ), occupied AS (
  SELECT r.company_id,'heartbeat:'||r.id::text AS owner FROM run_candidates r LEFT JOIN heartbeat_runs h ON h.company_id=r.company_id AND h.id=r.id
  WHERE h.id IS NULL OR h.status='running' OR h.native_process_cleanup_pending IS TRUE
   OR (h.native_process_cleanup_pending IS NULL AND h.runtime_mode='native'
    AND (h.status<>'queued' OR h.started_at IS NOT NULL OR h.process_started_at IS NOT NULL OR h.process_pid IS NOT NULL
     OR h.process_group_id IS NOT NULL OR h.native_phase IS NOT NULL OR h.session_id_after IS NOT NULL)
    AND NOT public.aw_v10_native_prelaunch_container_cleanup_completed(h.company_id,h.id))
   OR public.aw_v10_run_cleanup_pending(h)
  UNION SELECT (l.lease).company_id,CASE WHEN (l.lease).heartbeat_run_id IS NOT NULL THEN 'heartbeat:'||(l.lease).heartbeat_run_id::text
   WHEN (l.lease).metadata->>'_nativeHeartbeatRunId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN 'heartbeat:'||lower((l.lease).metadata->>'_nativeHeartbeatRunId') ELSE 'lease:'||(l.lease).id::text END
  FROM lease_candidates l WHERE public.aw_v10_pending_environment_cleanup(
   l.lease,coalesce(l.runtime_mode='native',true))
  UNION ALL SELECT company_id,'workflow:'||id::text FROM workflow_runs WHERE status IN ('running','recovering','cancelling')
   AND (target_company IS NULL OR company_id=target_company)
  UNION ALL SELECT company_id,'memory:'||id::text FROM memory_jobs WHERE status='running'
   AND (target_company IS NULL OR company_id=target_company)
 ) SELECT count(*) FROM occupied
$$;
