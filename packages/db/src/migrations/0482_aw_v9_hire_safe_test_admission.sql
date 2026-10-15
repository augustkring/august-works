CREATE OR REPLACE FUNCTION aw_v7_package_run_admission() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE i company_agent_package_installations; prior_id text; prior_hash text;
BEGIN
 -- The Original private controller writes its run before the correlated test
 -- because the test's native FK requires that run. The deferred guard below
 -- proves the complete durable correlation before this transaction commits.
 IF NEW.trigger_detail='agent_safe_test' AND NEW.context_snapshot ? 'agentConfigurationTestId'
   AND NOT (NEW.context_snapshot ? 'agentPackageInstallationId')
   AND NOT (NEW.context_snapshot ? 'agentPackageActivationHash')
   AND (TG_OP='INSERT' OR OLD.context_snapshot->>'agentPackageInstallationId' IS NULL) THEN
  RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' THEN
  prior_id:=OLD.context_snapshot->>'agentPackageInstallationId'; prior_hash:=OLD.context_snapshot->>'agentPackageActivationHash';
  IF prior_id IS NULL AND NEW.context_snapshot->>'agentPackageInstallationId' IS NOT NULL THEN RAISE EXCEPTION 'package_run_cannot_adopt_late_installation' USING ERRCODE='23514'; END IF;
  IF prior_id IS NOT NULL THEN
   IF (NEW.company_id,NEW.agent_id) IS DISTINCT FROM (OLD.company_id,OLD.agent_id) OR (NEW.context_snapshot->>'agentPackageInstallationId' IS NOT NULL AND NEW.context_snapshot->>'agentPackageInstallationId'<>prior_id) OR (NEW.context_snapshot->>'agentPackageActivationHash' IS NOT NULL AND NEW.context_snapshot->>'agentPackageActivationHash'<>prior_hash) THEN RAISE EXCEPTION 'package_run_pin_immutable' USING ERRCODE='23514'; END IF;
   NEW.context_snapshot:=coalesce(NEW.context_snapshot,'{}'::jsonb)||jsonb_build_object('agentPackageInstallationId',prior_id,'agentPackageActivationHash',prior_hash);
  END IF;
 END IF;
 IF (TG_OP='INSERT' OR NEW.status IS DISTINCT FROM OLD.status) AND NEW.status IN ('queued','running','scheduled_retry') AND EXISTS(SELECT 1 FROM company_agent_package_installations x WHERE x.company_id=NEW.company_id AND x.agent_id=NEW.agent_id) THEN
  SELECT * INTO i FROM company_agent_package_installations x WHERE x.company_id=NEW.company_id AND x.agent_id=NEW.agent_id AND aw_v7_package_installation_current(x);
  IF i.id IS NULL OR (TG_OP='UPDATE' AND (prior_id IS DISTINCT FROM i.id::text OR prior_hash IS DISTINCT FROM i.activation_hash)) THEN RAISE EXCEPTION 'package_run_activation_required' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' AND NEW.retry_of_run_id IS NOT NULL AND EXISTS(SELECT 1 FROM heartbeat_runs r WHERE r.company_id=NEW.company_id AND r.id=NEW.retry_of_run_id AND (r.context_snapshot->>'agentPackageInstallationId' IS DISTINCT FROM i.id::text OR r.context_snapshot->>'agentPackageActivationHash' IS DISTINCT FROM i.activation_hash)) THEN RAISE EXCEPTION 'package_retry_activation_changed' USING ERRCODE='23514'; END IF;
  NEW.context_snapshot:=coalesce(NEW.context_snapshot,'{}'::jsonb)||jsonb_build_object('agentPackageInstallationId',i.id::text,'agentPackageActivationHash',i.activation_hash);
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
-- No caller-supplied marker alone bypasses package admission. Every live
-- private test has its actual Original test, draft, hidden harness and paused
-- zero-tool plan; ordinary work continues through the original function above.
CREATE FUNCTION aw_v9_agent_safe_test_run_scope() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE current_run heartbeat_runs;
BEGIN
 SELECT * INTO current_run FROM heartbeat_runs WHERE id=NEW.id AND company_id=NEW.company_id;
 IF current_run.id IS NULL THEN RETURN NULL; END IF;
 IF current_run.status NOT IN ('queued','running','scheduled_retry') THEN RETURN NULL; END IF;
 IF current_run.trigger_detail IS DISTINCT FROM 'agent_safe_test'
   AND NOT coalesce(current_run.context_snapshot ? 'agentConfigurationTestId',false)
   AND (TG_OP='INSERT' OR OLD.trigger_detail IS DISTINCT FROM 'agent_safe_test') THEN RETURN NULL; END IF;
 -- Existing privacy closure may erase a still-held unknown financial run.
 -- It cannot create/revive work, and its Source remains excluded by the native
 -- run/financial boundaries independently of these removed context fields.
 IF TG_OP='UPDATE' AND current_run.status=OLD.status
   AND (current_run.id,current_run.company_id,current_run.agent_id,current_run.trigger_detail) IS NOT DISTINCT FROM (OLD.id,OLD.company_id,OLD.agent_id,OLD.trigger_detail)
   AND aw_workflow_memory_erased(current_run.company_id,current_run.id,NULL) THEN RETURN NULL; END IF;
 IF TG_OP='UPDATE' AND OLD.status NOT IN ('queued','running','scheduled_retry') THEN
  RAISE EXCEPTION 'agent_safe_test_closed_run_readonly' USING ERRCODE='23514';
 END IF;
 IF current_run.status<>'running' OR current_run.trigger_detail IS DISTINCT FROM 'agent_safe_test' OR current_run.invocation_source<>'on_demand' OR NOT EXISTS (
  SELECT 1 FROM agent_configuration_tests t
  JOIN agent_configuration_drafts d ON d.company_id=t.company_id AND d.id=t.draft_id
  JOIN orchestration_plans p ON p.company_id=t.company_id AND p.id=t.plan_id
  JOIN issues h ON h.company_id=p.company_id AND h.id=p.issue_id
  WHERE t.company_id=current_run.company_id AND t.agent_id=current_run.agent_id AND t.run_id=current_run.id
   AND t.created_by_user_id=current_run.responsible_user_id
   AND current_run.context_snapshot->>'agentConfigurationTestId'=t.id::text
   AND current_run.context_snapshot->>'draftId'=t.draft_id::text AND current_run.context_snapshot->>'candidateHash'=t.candidate_hash
   AND current_run.context_snapshot->>'toolsGranted'='false' AND current_run.context_snapshot->>'activatesAgent'='false'
   AND p.status='paused' AND p.erased_at IS NULL AND p.mode='single_worker' AND p.action_class='internal_draft' AND p.risk_class='C0'
   AND p.execution_principal->>'type'='user' AND p.execution_principal->>'userId'=t.created_by_user_id
   AND p.verification_mode='independent_required' AND p.human_oversight_mode='required'
   AND (p.budgets->>'maxModelCostMinor')::int=t.maximum_cost_minor AND (p.budgets->>'maxToolActions')::int=0
   AND (p.budgets->>'maxRetries')::int=0 AND (p.budgets->>'maxDelegationDepth')::int=0
   AND (p.budgets->>'maxWallClockSeconds')::int BETWEEN 1 AND 300 AND p.tool_actions_used=0
   AND h.hidden_at IS NOT NULL AND h.harness_kind='agent_safe_test'
   AND h.assignee_user_id=t.created_by_user_id AND h.assignee_agent_id IS NULL
   AND NOT EXISTS(SELECT 1 FROM orchestration_workers w WHERE w.company_id=p.company_id AND w.plan_id=p.id)
   AND (d.kind<>'hire' OR EXISTS(SELECT 1 FROM company_agent_package_installations i
     WHERE i.company_id=t.company_id AND i.agent_id=t.agent_id AND i.installed_version_id=d.package_version_id AND i.status<>'uninstalled'))
 ) THEN RAISE EXCEPTION 'agent_safe_test_original_run_scope_required' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER aw_v9_agent_safe_test_run_scope AFTER INSERT OR UPDATE ON heartbeat_runs
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION aw_v9_agent_safe_test_run_scope();
