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
  IF b.status NOT IN ('ready','stopped') OR c.status<>'STOPPED' OR b.cell_generation<>c.generation::text OR c.deleted_at IS NOT NULL OR NEW.expires_at<=now() OR NEW.compilation->>'proverResult'<>'pass' OR NEW.compilation->'compiledPolicy'->>'riskClass'='C4' OR NEW.capability_snapshot_hash IS DISTINCT FROM b.capability_snapshot_hash OR (b.capability_snapshot->>'expiresAt')::timestamptz<=now() OR NOT EXISTS(SELECT 1 FROM instance_settings WHERE singleton_key='default' AND experimental->>'sandbox_abstraction_v7'='true') OR NOT EXISTS(SELECT 1 FROM heartbeat_runs r JOIN issues i ON i.company_id=r.company_id AND i.id=r.native_issue_id WHERE r.company_id=m.company_id AND r.id=m.run_id AND r.agent_id=m.agent_id AND r.status='running' AND i.assignee_agent_id=m.agent_id AND i.hidden_at IS NULL AND r.responsible_user_id=m.manifest->>'responsibleUserId') THEN RAISE EXCEPTION 'sandbox_policy_current_execution_required' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
