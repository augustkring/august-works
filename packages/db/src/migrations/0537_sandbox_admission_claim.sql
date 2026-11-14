ALTER TABLE runtime_sandbox_bindings
  DROP CONSTRAINT sandbox_binding_status_check;
--> statement-breakpoint
ALTER TABLE runtime_sandbox_bindings
  ADD CONSTRAINT sandbox_binding_status_check
  CHECK (status in ('requested','ready','admitting','running','degraded','quarantined','stopping','stopped','failed','deleted'));
--> statement-breakpoint
CREATE FUNCTION aw_v7_sandbox_cell_not_quiescent(p_company_id uuid, p_cell_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(
  SELECT 1 FROM runtime_sandbox_bindings b
  WHERE b.company_id=p_company_id AND b.runtime_cell_id=p_cell_id
   AND (b.status IN ('admitting','running','stopping') OR (b.status='quarantined' AND (
    EXISTS(SELECT 1 FROM activity_log s WHERE s.company_id=b.company_id AND s.entity_type='runtime_sandbox' AND s.entity_id=b.id::text AND s.action='sandbox.admission_safety_fenced' AND s.details->>'stopConfirmed'='false' AND NOT EXISTS(SELECT 1 FROM activity_log s2 WHERE s2.company_id=s.company_id AND s2.entity_type=s.entity_type AND s2.entity_id=s.entity_id AND s2.action='sandbox.admission_safety_fenced' AND s2.details->>'claimKey' IS NOT DISTINCT FROM s.details->>'claimKey' AND (s2.created_at,s2.id)>(s.created_at,s.id)))
    OR EXISTS(SELECT 1 FROM activity_log w WHERE w.company_id=b.company_id AND w.entity_type='runtime_sandbox' AND w.entity_id=b.id::text AND w.action='sandbox.workload_started' AND NOT EXISTS(SELECT 1 FROM activity_log s WHERE s.company_id=w.company_id AND s.entity_type=w.entity_type AND s.entity_id=w.entity_id AND s.action='sandbox.admission_safety_fenced' AND s.details->>'claimKey'=w.details->>'claimKey' AND s.details->>'stopConfirmed'='true' AND (s.created_at,s.id)>(w.created_at,w.id)))
   )))
 );
$$;
--> statement-breakpoint
CREATE FUNCTION aw_v7_sandbox_host_not_quiescent(p_host_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM runtime_cells c WHERE c.runtime_host_id=p_host_id AND aw_v7_sandbox_cell_not_quiescent(c.company_id,c.id));
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
  IF c.deleted_at IS NOT NULL OR c.generation::text<>NEW.cell_generation OR q.id IS NULL OR q.status<>'passed' OR jsonb_array_length(q.results)<>18 OR EXISTS(SELECT 1 FROM jsonb_array_elements(q.results) r WHERE r->>'verdict'<>'pass' OR coalesce(r->>'observationHash','')!~'^[a-f0-9]{64}$') OR q.evidence_kind<>'protected_host_report' OR q.backend<>NEW.backend OR NEW.capability_snapshot IS NULL OR NEW.capability_snapshot_hash IS NULL OR NEW.capability_snapshot->>'qualificationHash'<>q.report_hash OR NEW.capability_snapshot->>'evidenceKind'<>'protected_host_report' OR NEW.capability_snapshot->>'backendVersion'<>q.backend_version OR NEW.capability_snapshot->>'sandboxImageDigest'<>coalesce(c.active_image_digest,c.desired_image_digest) OR (NEW.capability_snapshot->>'expiresAt')::timestamptz<=now() THEN RAISE EXCEPTION 'sandbox_current_protected_qualification_required' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION aw_v7_sandbox_runtime_receipt_authorized(p_company_id uuid,p_cell_id uuid,p_action text,p_details jsonb) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(
  SELECT 1 FROM runtime_sandbox_bindings b
  JOIN runtime_host_commands h ON h.id=(p_details->>'sandboxHostCommandId')::uuid
  JOIN activity_log a ON a.company_id=b.company_id AND a.entity_type='runtime_sandbox' AND a.entity_id=b.id::text AND a.action='sandbox.admission_claimed'
  WHERE b.company_id=p_company_id AND b.runtime_cell_id=p_cell_id AND b.id=(p_details->>'sandboxBindingId')::uuid
   AND b.cell_generation=p_details->>'generation'
   AND b.status=CASE WHEN p_action='start' THEN 'admitting' ELSE 'stopping' END
   AND a.details->>'claimKey'=p_details->>'claimKey'
   AND a.details->>'policySnapshotId'=p_details->>'policySnapshotId'
   AND a.details->>'generation'=p_details->>'generation'
   AND a.details->>'executionManifestId'=p_details->>'executionManifestId'
   AND a.details->>'executionManifestHash'=p_details->>'executionManifestHash'
   AND a.details->>'policyHash'=p_details->>'policyHash'
   AND h.company_id=p_company_id AND h.runtime_cell_id=p_cell_id AND h.cell_generation=(p_details->>'generation')::bigint
   AND h.command_type='v7_openshell_rpc' AND h.status='SUCCEEDED'
   AND h.payload->>'action'=p_action AND h.payload->'scope'->>'bindingId'=b.id::text
   AND h.payload->'scope'->>'cellGeneration'=p_details->>'generation'
   AND h.safe_result->>'action'=p_action
   AND CASE WHEN p_action='start' THEN h.safe_result->>'started'='true' AND h.safe_result->>'policyHash'=p_details->>'policyHash' AND h.payload->'start'->>'policyHash'=p_details->>'policyHash'
            ELSE h.safe_result->>'stopped'='true' END
 );
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v7_sandbox_native_admission_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF aw_v7_sandbox_cell_not_quiescent(NEW.company_id,NEW.runtime_cell_id) AND NOT (NEW.operation_type IN ('start','stop') AND aw_v7_sandbox_runtime_receipt_authorized(NEW.company_id,NEW.runtime_cell_id,NEW.operation_type,NEW.desired_state)) THEN RAISE EXCEPTION 'sandbox_workload_not_quiescent' USING ERRCODE='23514'; END IF;
 IF NEW.operation_type IN ('start','upgrade','restore','migrate') AND EXISTS(SELECT 1 FROM runtime_sandbox_bindings b WHERE b.company_id=NEW.company_id AND b.runtime_cell_id=NEW.runtime_cell_id) AND NOT (NEW.operation_type='start' AND aw_v7_sandbox_runtime_receipt_authorized(NEW.company_id,NEW.runtime_cell_id,NEW.operation_type,NEW.desired_state)) THEN RAISE EXCEPTION 'sandbox_applied_boundary_admission_required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION aw_v7_sandbox_active_cell_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF aw_v7_sandbox_cell_not_quiescent(OLD.company_id,OLD.id) AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at OR NEW.generation IS DISTINCT FROM OLD.generation OR NEW.runtime_host_id IS DISTINCT FROM OLD.runtime_host_id OR NEW.provider_binding_id IS DISTINCT FROM OLD.provider_binding_id OR NEW.active_image_digest IS DISTINCT FROM OLD.active_image_digest OR NEW.desired_image_digest IS DISTINCT FROM OLD.desired_image_digest) THEN
  IF NOT (NEW.status IS DISTINCT FROM OLD.status AND aw_v7_sandbox_runtime_receipt_authorized(OLD.company_id,OLD.id,CASE WHEN NEW.status='HEALTHY' THEN 'start' WHEN NEW.status='STOPPED' THEN 'stop' ELSE '' END,(SELECT o.desired_state FROM runtime_operations o WHERE o.company_id=OLD.company_id AND o.runtime_cell_id=OLD.id AND o.status='SUCCEEDED' AND o.operation_type=CASE WHEN NEW.status='HEALTHY' THEN 'start' WHEN NEW.status='STOPPED' THEN 'stop' ELSE '' END AND o.desired_state->>'sandboxBindingId'=(SELECT b.id::text FROM runtime_sandbox_bindings b WHERE b.company_id=OLD.company_id AND b.runtime_cell_id=OLD.id AND b.status IN ('admitting','stopping') LIMIT 1) ORDER BY o.completed_at DESC LIMIT 1))) THEN RAISE EXCEPTION 'sandbox_workload_not_quiescent' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v7_sandbox_active_cell_guard BEFORE UPDATE ON runtime_cells FOR EACH ROW EXECUTE FUNCTION aw_v7_sandbox_active_cell_guard();
--> statement-breakpoint
CREATE FUNCTION aw_v7_sandbox_host_retirement_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.operation_type='delete' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('aw-v7-sandbox-host:'||NEW.runtime_host_id::text,0));
  IF aw_v7_sandbox_host_not_quiescent(NEW.runtime_host_id) THEN RAISE EXCEPTION 'sandbox_workload_not_quiescent' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v7_sandbox_host_retirement_guard BEFORE INSERT ON runtime_host_provider_operations FOR EACH ROW EXECUTE FUNCTION aw_v7_sandbox_host_retirement_guard();
