-- Preparation is an immutable reference to an actual inactive Agent created
-- in the same Native transaction. It cannot qualify runtime or execution.
CREATE OR REPLACE FUNCTION aw_v9_authoring_agent_preparation_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.prepared_agent_id IS NOT NULL THEN
      RAISE EXCEPTION 'New drafts cannot borrow an Agent preparation' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.prepared_agent_id IS NOT NULL THEN
    IF ROW(NEW.id,NEW.company_id,NEW.created_by_user_id,NEW.agent_id,NEW.kind,NEW.package_version_id,NEW.package_key,NEW.package_content_hash,
           NEW.creation_request_id,NEW.creation_request_hash,NEW.prepared_agent_id,NEW.preparation_approval_id,NEW.preparation_configuration_hash,
           NEW.preparation_request_id,NEW.preparation_request_hash,NEW.preparation_review_hash)
       IS DISTINCT FROM ROW(OLD.id,OLD.company_id,OLD.created_by_user_id,OLD.agent_id,OLD.kind,OLD.package_version_id,OLD.package_key,OLD.package_content_hash,
           OLD.creation_request_id,OLD.creation_request_hash,OLD.prepared_agent_id,OLD.preparation_approval_id,OLD.preparation_configuration_hash,
           OLD.preparation_request_id,OLD.preparation_request_hash,OLD.preparation_review_hash) THEN
      RAISE EXCEPTION 'Original inactive Agent preparation identity is immutable' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.prepared_agent_id IS NOT NULL THEN
    IF OLD.agent_id IS NOT NULL OR NEW.agent_id IS NOT NULL OR OLD.status<>'draft' OR NEW.status<>'draft' OR
       NEW.id IS DISTINCT FROM OLD.id OR NEW.company_id IS DISTINCT FROM OLD.company_id OR
       NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id OR NEW.content IS DISTINCT FROM OLD.content OR
       NEW.version<>OLD.version+1 OR NOT EXISTS (
      SELECT 1 FROM agents a JOIN companies c ON c.id=a.company_id
      JOIN "user" u ON u.id=NEW.created_by_user_id
      JOIN company_memberships m ON m.company_id=c.id AND m.principal_type='user' AND m.principal_id=u.id
      WHERE a.id=NEW.prepared_agent_id AND a.company_id=NEW.company_id AND c.status='active'
        AND u.email_verified AND m.status='active' AND a.created_at=transaction_timestamp()
        AND a.role='general' AND a.adapter_type='openclaw_gateway' AND a.adapter_config='{}'::jsonb
        AND a.runtime_config->'heartbeat'->>'enabled'='false' AND a.budget_monthly_cents=0
        AND a.reports_to IS NULL AND a.default_environment_id IS NULL
        AND a.permissions->>'canCreateAgents'='false' AND a.permissions->>'canCreateSkills'='false'
        AND NOT EXISTS (SELECT 1 FROM jsonb_each(a.permissions) e WHERE e.value IS DISTINCT FROM 'false'::jsonb)
        AND NOT EXISTS (SELECT 1 FROM tool_connection_installs i WHERE i.company_id=c.id AND ((i.target_type='agent' AND i.target_id=a.id::text) OR (i.target_type='company' AND i.target_id=c.id::text)))
        AND NOT EXISTS (SELECT 1 FROM tool_profile_bindings b WHERE b.company_id=c.id AND ((b.target_type='agent' AND b.target_id=a.id::text) OR (b.target_type='company' AND b.target_id=c.id::text)))
        AND NOT EXISTS (SELECT 1 FROM connection_grant_delegations d WHERE d.company_id=c.id AND d.agent_id=a.id)
        AND NOT EXISTS (SELECT 1 FROM connection_grants g WHERE g.company_id=c.id AND g.subject_agent_id=a.id)
        AND NOT EXISTS (SELECT 1 FROM heartbeat_runs r WHERE r.company_id=c.id AND r.agent_id=a.id)
        AND (NOT c.require_board_approval_for_new_agents AND a.status='paused' AND NEW.preparation_approval_id IS NULL
          OR c.require_board_approval_for_new_agents AND a.status='pending_approval' AND EXISTS (
            SELECT 1 FROM approvals approval WHERE approval.id=NEW.preparation_approval_id AND approval.company_id=c.id
              AND approval.type='hire_agent' AND approval.status='pending' AND approval.requested_by_user_id=u.id
              AND approval.payload->>'agentId'=a.id::text AND approval.created_at=transaction_timestamp()))
    ) THEN RAISE EXCEPTION 'Actual same-transaction inactive Agent and current verified creator are required' USING ERRCODE='23514'; END IF;
    IF NEW.kind='hire' AND NOT EXISTS (
      SELECT 1 FROM agent_package_versions v JOIN agent_packages p ON p.id=v.agent_package_id
      WHERE v.id=NEW.package_version_id AND v.state='published' AND p.status='active'
        AND v.content_hash=NEW.package_content_hash AND p.key=NEW.package_key
    ) THEN RAISE EXCEPTION 'Current Original published capability pin is required' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v9_authoring_agent_preparation_guard BEFORE INSERT OR UPDATE
ON agent_configuration_drafts FOR EACH ROW EXECUTE FUNCTION aw_v9_authoring_agent_preparation_guard();
