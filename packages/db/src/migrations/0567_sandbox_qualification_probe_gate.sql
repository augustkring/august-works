CREATE FUNCTION aw_v7_sandbox_qualification_probes_valid(p_results jsonb, p_target_hash text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 WITH canonical(case_id) AS (VALUES
  ('filesystem_allow'),('filesystem_deny'),('filesystem_escape'),
  ('process_nonprivileged'),('process_privilege_denied'),
  ('syscall_allow'),('syscall_deny'),
  ('network_allow'),('network_host_port_deny'),('network_dns_redirect_deny'),
  ('network_l7_allow'),('network_l7_deny'),
  ('credential_allow'),('credential_raw_read_deny'),('credential_wrong_destination_deny'),
  ('credential_wrong_binary_deny'),('credential_revoke_deny'),
  ('resource_exhaustion_contained'),('force_stop')
 ), rows AS (SELECT value AS probe FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_results)='array' THEN p_results ELSE '[]'::jsonb END))
 SELECT coalesce((CASE WHEN jsonb_typeof(p_results)='array' THEN jsonb_array_length(p_results)=19 ELSE false END)
  AND p_target_hash ~ '^[a-f0-9]{64}$'
  AND (SELECT count(DISTINCT probe->>'caseId')=19 AND count(*)=19
       AND bool_and(EXISTS(SELECT 1 FROM canonical c WHERE c.case_id=probe->>'caseId'))
       AND bool_and(coalesce(probe->>'verdict'='pass', false))
       AND bool_and(coalesce(probe->>'observationHash','') ~ '^[a-f0-9]{64}$')
       AND bool_and(coalesce(probe->>'targetQualificationHash'=p_target_hash, false))
       FROM rows), false);
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v7_sandbox_binding_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c runtime_cells; q sandbox_qualification_runs;
BEGIN
 SELECT * INTO c FROM runtime_cells WHERE company_id=NEW.company_id AND id=NEW.runtime_cell_id;
 IF TG_OP='INSERT' AND c.status<>'STOPPED' THEN RAISE EXCEPTION 'sandbox_binding_requires_stopped_cell' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' AND NEW.status IN ('admitting','running') THEN RAISE EXCEPTION 'sandbox_admission_requires_durable_claim_transition' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (NEW.company_id,NEW.runtime_cell_id,NEW.cell_generation,NEW.backend,NEW.profile,NEW.boundary_policy,NEW.boundary_policy_hash,NEW.created_by_user_id,NEW.created_at) IS DISTINCT FROM (OLD.company_id,OLD.runtime_cell_id,OLD.cell_generation,OLD.backend,OLD.profile,OLD.boundary_policy,OLD.boundary_policy_hash,OLD.created_by_user_id,OLD.created_at) THEN RAISE EXCEPTION 'sandbox_binding_boundary_immutable' USING ERRCODE='23514'; END IF;
 IF NEW.backend NOT IN ('existing_cell_container','openshell') OR NEW.profile NOT IN ('development','compatibility','standard_managed','high_assurance_managed') OR NEW.boundary_policy->>'profile'<>NEW.profile THEN RAISE EXCEPTION 'sandbox_binding_contract_invalid' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND NEW.status IN ('admitting','running') THEN
  IF c.runtime_host_id IS NOT NULL THEN
   PERFORM pg_advisory_xact_lock(hashtextextended('aw-v7-sandbox-host:'||c.runtime_host_id::text,0));
   IF EXISTS(SELECT 1 FROM runtime_host_provider_operations o WHERE o.runtime_host_id=c.runtime_host_id AND o.operation_type='delete') THEN RAISE EXCEPTION 'sandbox_host_retirement_in_progress' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 IF NEW.status IN ('ready','running') THEN
  SELECT * INTO q FROM sandbox_qualification_runs WHERE company_id=NEW.company_id AND id=NEW.qualification_run_id AND binding_id=NEW.id;
  IF c.deleted_at IS NOT NULL OR c.generation::text<>NEW.cell_generation OR q.id IS NULL OR q.status<>'passed' OR NOT aw_v7_sandbox_qualification_probes_valid(q.results, NEW.capability_snapshot->'qualificationTarget'->>'targetHash') OR q.evidence_kind<>'protected_host_report' OR q.backend<>NEW.backend OR NEW.capability_snapshot IS NULL OR NEW.capability_snapshot_hash IS NULL OR NEW.capability_snapshot->>'qualificationHash'<>q.report_hash OR NEW.capability_snapshot->>'evidenceKind'<>'protected_host_report' OR NEW.capability_snapshot->>'backendVersion'<>q.backend_version OR NEW.capability_snapshot->>'sandboxImageDigest'<>coalesce(c.active_image_digest,c.desired_image_digest) OR (NEW.capability_snapshot->>'expiresAt')::timestamptz<=now() THEN RAISE EXCEPTION 'sandbox_current_protected_qualification_required' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
