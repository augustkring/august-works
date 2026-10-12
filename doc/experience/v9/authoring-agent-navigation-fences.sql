-- Preserve every accepted-save version and its original concurrency contract.
-- This runs in the original migration transaction, before application admission.
-- Backfill the material pin without changing customer content or save versions.
ALTER TABLE agent_configuration_drafts DISABLE TRIGGER aw_v9_agent_configuration_draft_guard;
UPDATE agent_configuration_drafts SET candidate_revision=version;
ALTER TABLE agent_configuration_drafts ENABLE TRIGGER aw_v9_agent_configuration_draft_guard;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v9_agent_configuration_draft_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.kind='custom' AND NEW.step NOT IN ('outcome','identity','instructions','knowledge','tools','authority','memory','collaboration','runtime','test','review','publish','monitor'))
 OR (NEW.kind='hire' AND NEW.step NOT IN ('hire_access','hire_authority','hire_test','hire_review','hire_receipt')) THEN
  RAISE EXCEPTION 'agent_configuration_draft_step_invalid' USING ERRCODE='23514';
 END IF;
 IF TG_OP='INSERT' AND NEW.kind='hire' AND NOT EXISTS (
  SELECT 1 FROM agent_package_versions v JOIN agent_packages p ON p.id=v.agent_package_id
  WHERE v.id=NEW.package_version_id AND p.package_key=NEW.package_key AND v.content_hash=NEW.package_content_hash
 ) THEN
  RAISE EXCEPTION 'hire_source_pin_invalid' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' THEN
  IF (NEW.id,NEW.company_id,NEW.agent_id,NEW.created_by_user_id,NEW.creation_request_id,NEW.creation_request_hash,NEW.baseline_hash,NEW.created_at,NEW.kind,NEW.package_version_id,NEW.package_key,NEW.package_content_hash)
      IS DISTINCT FROM (OLD.id,OLD.company_id,OLD.agent_id,OLD.created_by_user_id,OLD.creation_request_id,OLD.creation_request_hash,OLD.baseline_hash,OLD.created_at,OLD.kind,OLD.package_version_id,OLD.package_key,OLD.package_content_hash) THEN
   RAISE EXCEPTION 'agent_configuration_draft_scope_immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.version<>OLD.version+1 OR OLD.status='discarded' THEN
   RAISE EXCEPTION 'agent_configuration_draft_version_conflict' USING ERRCODE='23514';
  END IF;
  IF NEW.candidate_revision <> OLD.candidate_revision + (CASE WHEN NEW.content IS DISTINCT FROM OLD.content THEN 1 ELSE 0 END) THEN
   RAISE EXCEPTION 'agent_configuration_draft_candidate_conflict' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;

--> statement-breakpoint
CREATE FUNCTION aw_v9_agent_test_candidate_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NEW.candidate_revision IS NULL OR NOT EXISTS (
  SELECT 1 FROM agent_configuration_drafts d WHERE d.company_id=NEW.company_id AND d.id=NEW.draft_id
   AND d.version=NEW.draft_version AND d.candidate_revision=NEW.candidate_revision
 ) THEN RAISE EXCEPTION 'agent_test_candidate_revision_invalid' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v9_agent_test_candidate_guard BEFORE INSERT ON agent_configuration_tests
 FOR EACH ROW EXECUTE FUNCTION aw_v9_agent_test_candidate_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v9_agent_test_model_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE b budget_policies; target_agent uuid; observed bigint; exposed bigint; period_start timestamptz; period_end timestamptz;
BEGIN
 IF NEW.purpose<>'agent_safe_test' OR (TG_OP='UPDATE' AND NEW.status<>'dispatched') THEN RETURN NEW; END IF;
 PERFORM 1 FROM companies WHERE id=NEW.company_id FOR UPDATE;
 IF NOT EXISTS (
   SELECT 1 FROM agent_configuration_tests t
   JOIN agent_configuration_drafts d ON d.company_id=t.company_id AND d.id=t.draft_id
   JOIN heartbeat_runs r ON r.company_id=t.company_id AND r.agent_id=t.agent_id AND r.id=t.run_id
   JOIN orchestration_plans p ON p.company_id=t.company_id AND p.id=t.plan_id
   JOIN issues i ON i.company_id=p.company_id AND i.id=p.issue_id
   WHERE t.company_id=NEW.company_id AND t.plan_id=NEW.plan_id AND t.created_by_user_id=NEW.principal_user_id
     AND t.authority_hash=NEW.authority_hash AND t.maximum_cost_minor=NEW.maximum_minor
     AND d.status='draft' AND d.candidate_revision=coalesce(t.candidate_revision,t.draft_version) AND d.created_by_user_id=t.created_by_user_id
     AND p.status='paused' AND p.erased_at IS NULL AND p.started_at IS NOT NULL
     AND p.started_at+make_interval(secs=>(p.budgets->>'maxWallClockSeconds')::int)>clock_timestamp()
     AND p.action_class='internal_draft' AND p.risk_class='C0' AND p.tool_actions_used=0
     AND (p.budgets->>'maxToolActions')::int=0 AND (p.budgets->>'maxModelCostMinor')::int=t.maximum_cost_minor
     AND p.created_by=t.created_by_user_id AND p.execution_principal->>'type'='user'
     AND p.execution_principal->>'userId'=t.created_by_user_id AND i.hidden_at IS NOT NULL AND i.harness_kind='agent_safe_test'
     AND r.status='running' AND r.trigger_detail='agent_safe_test' AND r.responsible_user_id=t.created_by_user_id
     AND NEW.worker_id IS NULL AND NEW.worker_attempt_id IS NULL
     AND NOT EXISTS(SELECT 1 FROM orchestration_workers w WHERE w.company_id=t.company_id AND w.plan_id=t.plan_id)
     AND (TG_OP='UPDATE' OR NOT EXISTS(SELECT 1 FROM orchestration_model_reservations mr WHERE mr.company_id=t.company_id AND mr.plan_id=t.plan_id))
 ) THEN RAISE EXCEPTION 'agent_test_model_harness_closed' USING ERRCODE='23514'; END IF;
 SELECT agent_id INTO target_agent FROM agent_configuration_tests WHERE company_id=NEW.company_id AND plan_id=NEW.plan_id;
 period_start:=date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
 period_end:=period_start+interval '1 month';
 FOR b IN SELECT * FROM budget_policies WHERE company_id=NEW.company_id AND metric='billed_cents' AND is_active AND hard_stop_enabled AND amount>0
   AND ((scope_type='company' AND scope_id=NEW.company_id) OR (scope_type='agent' AND scope_id=target_agent)) FOR SHARE
 LOOP
   SELECT coalesce(sum(cost_cents),0) INTO observed FROM cost_events WHERE company_id=NEW.company_id
     AND (b.scope_type='company' OR agent_id=target_agent)
     AND (b.window_kind='lifetime' OR occurred_at>=period_start AND occurred_at<period_end);
   SELECT coalesce(sum(greatest(0,mr.maximum_minor - (SELECT coalesce(sum(ce.cost_cents),0) FROM cost_events ce
     WHERE ce.company_id=t.company_id AND ce.heartbeat_run_id=t.run_id
       AND (b.window_kind='lifetime' OR ce.occurred_at>=period_start AND ce.occurred_at<period_end)))),0) INTO exposed
     FROM agent_configuration_tests t JOIN orchestration_model_reservations mr ON mr.company_id=t.company_id AND mr.plan_id=t.plan_id AND mr.purpose='agent_safe_test'
     WHERE t.company_id=NEW.company_id AND t.plan_id<>NEW.plan_id AND (b.scope_type='company' OR t.agent_id=target_agent)
       AND (b.window_kind='lifetime' OR mr.created_at>=period_start AND mr.created_at<period_end);
   IF observed+exposed+NEW.maximum_minor>b.amount THEN RAISE EXCEPTION 'agent_test_native_budget_ceiling_exceeded' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
