-- Pending Source: append to the real generated Drizzle retirement migration
-- before qualification. This file alone is not an installed migration.
CREATE OR REPLACE FUNCTION public.aw_v9_agent_is_retired(p_company uuid, p_agent text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, public AS $$
DECLARE current_status text;
BEGIN
  -- Every active binding writer latches the original Agent before deciding.
  -- It waits for a concurrent retirement, then reads its committed receipt.
  IF p_agent IS NULL OR p_agent !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN false; END IF;
  SELECT status INTO current_status FROM public.agents
    WHERE company_id=p_company AND id=p_agent::uuid FOR KEY SHARE;
  IF current_status IS DISTINCT FROM 'terminated' THEN RETURN false; END IF;
  RETURN EXISTS(SELECT 1 FROM public.agent_retirements WHERE company_id=p_company AND agent_id=p_agent::uuid);
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.aw_v9_retired_agent_state_fence()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF public.aw_v9_agent_is_retired(NEW.company_id, NEW.id::text)
    AND (NEW.status <> 'terminated' OR NEW.permissions IS DISTINCT FROM '{}'::jsonb) THEN
    RAISE EXCEPTION 'AW_V9_AGENT_RETIRED' USING ERRCODE='23514';
  END IF;
  IF NEW.status <> 'terminated' AND NEW.reports_to IS NOT NULL
    AND public.aw_v9_agent_is_retired(NEW.company_id, NEW.reports_to::text) THEN
    RAISE EXCEPTION 'AW_V9_AGENT_RETIRED' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER aw_v9_retired_agent_state_fence BEFORE INSERT OR UPDATE ON public.agents
FOR EACH ROW EXECUTE FUNCTION public.aw_v9_retired_agent_state_fence();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.aw_v9_agent_retirement_receipt_fence()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    -- Permit original Agent/company erasure cascades, while preserving the
    -- retirement fence for an Agent that still exists in an existing company.
    IF EXISTS(SELECT 1 FROM public.companies WHERE id=OLD.company_id)
      AND EXISTS(SELECT 1 FROM public.agents WHERE company_id=OLD.company_id AND id=OLD.agent_id) THEN
      RAISE EXCEPTION 'AW_V9_AGENT_RETIREMENT_IMMUTABLE' USING ERRCODE='23514';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'AW_V9_AGENT_RETIREMENT_IMMUTABLE' USING ERRCODE='23514'; END IF;
  IF current_setting('aw_v9.agent_retirement_intent', true) IS DISTINCT FROM
      NEW.company_id::text || ':' || NEW.agent_id::text || ':' || NEW.request_id::text
    OR NOT EXISTS(SELECT 1 FROM public.agents WHERE company_id=NEW.company_id AND id=NEW.agent_id AND status='terminated') THEN
    RAISE EXCEPTION 'AW_V9_AGENT_RETIREMENT_OWNER_REQUIRED' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER aw_v9_agent_retirement_receipt_fence BEFORE INSERT OR UPDATE OR DELETE ON public.agent_retirements
FOR EACH ROW EXECUTE FUNCTION public.aw_v9_agent_retirement_receipt_fence();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.aw_v9_retired_agent_binding_fence()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE target_agent text; active_binding boolean := false; owner_company uuid;
BEGIN
  owner_company:=NEW.company_id;
  -- Read only fixed original routing/authority metadata. Do not materialize
  -- configuration, credentials, arguments, messages or workflow output.
  CASE TG_TABLE_NAME
    WHEN 'agent_api_keys' THEN target_agent:=NEW.agent_id::text; active_binding:=NEW.revoked_at IS NULL;
    WHEN 'principal_permission_grants' THEN
      target_agent:=NEW.principal_id; active_binding:=NEW.principal_type='agent';
    WHEN 'company_memberships' THEN
      target_agent:=NEW.principal_id; active_binding:=NEW.principal_type='agent' AND NEW.status='active';
    WHEN 'connection_grant_delegations' THEN target_agent:=NEW.agent_id::text; active_binding:=true;
    WHEN 'tool_connection_installs', 'company_secret_bindings', 'tool_profile_bindings' THEN
      target_agent:=NEW.target_id; active_binding:=NEW.target_type='agent';
    WHEN 'agent_presence_runtime_bindings' THEN target_agent:=NEW.agent_id::text; active_binding:=NEW.status<>'revoked';
    WHEN 'tool_mcp_gateway_tokens' THEN
      target_agent:=NEW.subject_id; active_binding:=NEW.subject_type='agent' AND NEW.revoked_at IS NULL;
    WHEN 'tool_gateway_sessions' THEN target_agent:=NEW.agent_id::text; active_binding:=NEW.revoked_at IS NULL;
    WHEN 'connection_grants' THEN target_agent:=NEW.subject_agent_id::text; active_binding:=NEW.status<>'revoked';
    WHEN 'tool_oauth_states' THEN target_agent:=NEW.subject_agent_id::text; active_binding:=NEW.expires_at>clock_timestamp();
    WHEN 'company_agent_package_installations' THEN
      target_agent:=NEW.agent_id::text; active_binding:=NEW.status NOT IN ('suspended','uninstalled');
    WHEN 'agent_wakeup_requests' THEN
      target_agent:=NEW.agent_id::text; active_binding:=NEW.status IN ('queued','claimed');
    WHEN 'heartbeat_runs' THEN target_agent:=NEW.agent_id::text; active_binding:=NEW.status IN ('queued','scheduled_retry','running');
    WHEN 'issues' THEN target_agent:=NEW.assignee_agent_id::text; active_binding:=NEW.status NOT IN ('done','cancelled');
    WHEN 'tool_invocations' THEN
      target_agent:=NEW.agent_id::text; active_binding:=NEW.status IN ('pending','authorized','awaiting_approval','executing','failed','timed_out');
    WHEN 'workflow_step_runs' THEN
      target_agent:=NEW.agent_id::text; active_binding:=NEW.status IN ('pending','running','waiting','retry_scheduled','cancelling');
    WHEN 'orchestration_workers' THEN
      target_agent:=NEW.agent_id::text;
      active_binding:=EXISTS(SELECT 1 FROM public.orchestration_plans WHERE company_id=NEW.company_id AND id=NEW.plan_id AND status NOT IN ('completed','cancelled','failed'));
    WHEN 'orchestration_worker_attempts' THEN target_agent:=NEW.agent_id::text; active_binding:=NEW.status='running';
    WHEN 'connection_token_issuances' THEN
      target_agent:=NEW.agent_id::text;
      active_binding:=NEW.outcome IN ('success','upstream_error','failure') AND (NEW.expires_at IS NULL OR NEW.expires_at>clock_timestamp());
    WHEN 'issue_thread_interactions' THEN
      IF NEW.status='pending' AND NEW.created_by_agent_id IS NOT NULL
        AND public.aw_v9_agent_is_retired(NEW.company_id,NEW.created_by_agent_id::text) THEN
        RAISE EXCEPTION 'AW_V9_AGENT_RETIRED' USING ERRCODE='23514';
      END IF;
      target_agent:=NEW.addressee_agent_id::text; active_binding:=NEW.status='pending';
    WHEN 'approvals' THEN
      IF NEW.status IN ('pending','revision_requested') AND NEW.requested_by_agent_id IS NOT NULL
        AND public.aw_v9_agent_is_retired(owner_company,NEW.requested_by_agent_id::text) THEN
        RAISE EXCEPTION 'AW_V9_AGENT_RETIRED' USING ERRCODE='23514';
      END IF;
      target_agent:=NEW.payload->>'agentId'; active_binding:=NEW.status IN ('pending','revision_requested');
    WHEN 'workflow_runs' THEN
      target_agent:=NEW.execution_principal->>'agentId';
      active_binding:=NEW.execution_principal->>'type'='agent' AND NEW.status IN ('queued','running','waiting','recovering','cancelling');
    WHEN 'tool_action_requests' THEN
      SELECT agent_id::text INTO target_agent FROM public.tool_invocations
        WHERE company_id=owner_company AND id=NEW.invocation_id;
      active_binding:=NEW.status IN ('pending','approved');
    ELSE RAISE EXCEPTION 'AW_V9_AGENT_RETIREMENT_UNSUPPORTED_OWNER' USING ERRCODE='23514';
  END CASE;
  IF active_binding AND target_agent IS NOT NULL AND public.aw_v9_agent_is_retired(owner_company,target_agent) THEN
    RAISE EXCEPTION 'AW_V9_AGENT_RETIRED' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
DECLARE owner_table text;
BEGIN
  FOREACH owner_table IN ARRAY ARRAY[
    'agent_api_keys','principal_permission_grants','company_memberships','connection_grant_delegations',
    'tool_connection_installs','company_secret_bindings','tool_profile_bindings',
    'agent_presence_runtime_bindings','tool_mcp_gateway_tokens','tool_gateway_sessions','connection_grants','tool_oauth_states',
    'company_agent_package_installations','agent_wakeup_requests','heartbeat_runs',
    'issues','tool_invocations','workflow_step_runs','orchestration_workers',
    'orchestration_worker_attempts','connection_token_issuances','issue_thread_interactions','approvals',
    'workflow_runs','tool_action_requests'
  ] LOOP
    EXECUTE format('CREATE TRIGGER aw_v9_retired_agent_binding_fence BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.aw_v9_retired_agent_binding_fence()',owner_table);
  END LOOP;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.aw_v9_retired_agent_automation_fence()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE owner_company uuid; target_agent text; candidate record;
BEGIN
  -- Only original Agent routing fields are inspected. Historical revisions
  -- stay readable; choosing a revision again must recheck its current owner.
  CASE TG_TABLE_NAME
    WHEN 'routines' THEN
      owner_company:=NEW.company_id;
      IF public.aw_v9_agent_is_retired(owner_company,NEW.assignee_agent_id::text)
        OR (NEW.execution_target_kind='agent_task' AND public.aw_v9_agent_is_retired(owner_company,NEW.execution_target_ref::text))
        OR (NEW.workflow_execution_principal->>'type'='agent' AND public.aw_v9_agent_is_retired(owner_company,NEW.workflow_execution_principal->>'agentId')) THEN
        RAISE EXCEPTION 'AW_V9_AGENT_RETIRED' USING ERRCODE='23514';
      END IF;
    WHEN 'pipeline_stages' THEN
      SELECT company_id INTO owner_company FROM public.pipelines WHERE id=NEW.pipeline_id;
      IF (NEW.workflow_execution_principal->>'type'='agent' AND public.aw_v9_agent_is_retired(owner_company,NEW.workflow_execution_principal->>'agentId'))
        OR public.aw_v9_agent_is_retired(owner_company,NEW.config->'automation'->>'assigneeAgentId')
        OR (NEW.config->'approver'->>'kind'='agent' AND public.aw_v9_agent_is_retired(owner_company,NEW.config->'approver'->>'id')) THEN
        RAISE EXCEPTION 'AW_V9_AGENT_RETIRED' USING ERRCODE='23514';
      END IF;
    WHEN 'workflows' THEN
      owner_company:=NEW.company_id;
      IF NEW.status<>'archived' THEN
        FOR candidate IN SELECT graph_json FROM public.workflow_revisions
          WHERE company_id=owner_company AND workflow_id=NEW.id AND id IN (NEW.published_revision_id,NEW.draft_revision_id)
        LOOP
          FOR target_agent IN SELECT node->'config'->>'agentId' FROM jsonb_array_elements(candidate.graph_json->'nodes') node LOOP
            IF public.aw_v9_agent_is_retired(owner_company,target_agent) THEN
              RAISE EXCEPTION 'AW_V9_AGENT_RETIRED' USING ERRCODE='23514';
            END IF;
          END LOOP;
        END LOOP;
      END IF;
    WHEN 'workflow_revisions' THEN
      owner_company:=NEW.company_id;
      IF EXISTS(SELECT 1 FROM public.workflows WHERE company_id=owner_company AND id=NEW.workflow_id
        AND status<>'archived' AND NEW.id IN (published_revision_id,draft_revision_id)) THEN
        FOR target_agent IN SELECT node->'config'->>'agentId' FROM jsonb_array_elements(NEW.graph_json->'nodes') node LOOP
          IF public.aw_v9_agent_is_retired(owner_company,target_agent) THEN
            RAISE EXCEPTION 'AW_V9_AGENT_RETIRED' USING ERRCODE='23514';
          END IF;
        END LOOP;
      END IF;
    WHEN 'orchestration_plans' THEN
      IF NEW.status NOT IN ('completed','cancelled','failed') THEN
        FOR target_agent IN SELECT agent_id::text FROM public.orchestration_workers
          WHERE company_id=NEW.company_id AND plan_id=NEW.id ORDER BY agent_id LOOP
          IF public.aw_v9_agent_is_retired(NEW.company_id,target_agent) THEN
            RAISE EXCEPTION 'AW_V9_AGENT_RETIRED' USING ERRCODE='23514';
          END IF;
        END LOOP;
      END IF;
    ELSE RAISE EXCEPTION 'AW_V9_AGENT_RETIREMENT_UNSUPPORTED_OWNER' USING ERRCODE='23514';
  END CASE;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
DECLARE owner_table text;
BEGIN
  FOREACH owner_table IN ARRAY ARRAY['routines','pipeline_stages','workflows','workflow_revisions','orchestration_plans'] LOOP
    EXECUTE format('CREATE TRIGGER aw_v9_retired_agent_automation_fence BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.aw_v9_retired_agent_automation_fence()',owner_table);
  END LOOP;
END;
$$;
