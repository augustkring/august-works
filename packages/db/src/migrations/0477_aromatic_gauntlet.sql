CREATE TABLE "agent_configuration_tests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"draft_id" uuid NOT NULL,
	"created_by_user_id" text NOT NULL,
	"request_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"draft_version" integer NOT NULL,
	"scenario_index" integer NOT NULL,
	"agent_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"runtime_binding_id" uuid NOT NULL,
	"provider_binding_id" uuid NOT NULL,
	"candidate_hash" text NOT NULL,
	"configuration_hash" text NOT NULL,
	"authority_hash" text NOT NULL,
	"review_hash" text NOT NULL,
	"maximum_cost_minor" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_configuration_tests_counter_check" CHECK ("agent_configuration_tests"."draft_version">0 and "agent_configuration_tests"."scenario_index" between 0 and 9 and "agent_configuration_tests"."maximum_cost_minor" between 0 and 1000000),
	CONSTRAINT "agent_configuration_tests_hash_check" CHECK ("agent_configuration_tests"."request_hash" ~ '^[a-f0-9]{64}$' and "agent_configuration_tests"."candidate_hash" ~ '^[a-f0-9]{64}$' and "agent_configuration_tests"."configuration_hash" ~ '^[a-f0-9]{64}$' and "agent_configuration_tests"."authority_hash" ~ '^[a-f0-9]{64}$' and "agent_configuration_tests"."review_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "orchestration_model_reservations" DROP CONSTRAINT "orchestration_model_reservation_purpose_ck";--> statement-breakpoint
ALTER TABLE "agent_configuration_tests" ADD CONSTRAINT "agent_configuration_tests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_configuration_tests" ADD CONSTRAINT "agent_configuration_tests_draft_id_agent_configuration_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."agent_configuration_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_configuration_tests" ADD CONSTRAINT "agent_configuration_tests_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_configuration_tests" ADD CONSTRAINT "agent_configuration_tests_company_id_agent_id_agents_company_id_id_fk" FOREIGN KEY ("company_id","agent_id") REFERENCES "public"."agents"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_configuration_tests" ADD CONSTRAINT "agent_configuration_tests_company_id_agent_id_run_id_heartbeat_runs_company_id_agent_id_id_fk" FOREIGN KEY ("company_id","agent_id","run_id") REFERENCES "public"."heartbeat_runs"("company_id","agent_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_configuration_tests" ADD CONSTRAINT "agent_configuration_tests_company_id_plan_id_orchestration_plans_company_id_id_fk" FOREIGN KEY ("company_id","plan_id") REFERENCES "public"."orchestration_plans"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_configuration_tests_request_uq" ON "agent_configuration_tests" USING btree ("company_id","created_by_user_id","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_configuration_tests_run_uq" ON "agent_configuration_tests" USING btree ("company_id","run_id");--> statement-breakpoint
ALTER TABLE "orchestration_model_reservations" ADD CONSTRAINT "orchestration_model_reservation_purpose_ck" CHECK ("orchestration_model_reservations"."purpose" in ('worker_model','read_only_verification','read_only_trajectory','provider_conformance','agent_safe_test'));
--> statement-breakpoint
-- Correlation is immutable. Execution, verification and cost remain with their
-- existing Native owners; this table cannot invent a successful outcome.
CREATE FUNCTION aw_v9_agent_test_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN
   IF EXISTS(SELECT 1 FROM companies WHERE id=OLD.company_id)
   THEN RAISE EXCEPTION 'agent_test_original_request_retained' USING ERRCODE='23514'; END IF;
   RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'agent_test_correlation_immutable' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS (
   SELECT 1 FROM agent_configuration_drafts d
   JOIN companies c ON c.id=d.company_id
   JOIN "user" u ON u.id=d.created_by_user_id
   JOIN company_memberships m ON m.company_id=c.id AND m.principal_type='user' AND m.principal_id=u.id
   JOIN agents a ON a.company_id=c.id AND a.id=coalesce(d.agent_id,d.prepared_agent_id)
   JOIN agent_presence_runtime_bindings rb ON rb.company_id=c.id AND rb.agent_id=a.id
   JOIN agent_provider_bindings pb ON pb.id=rb.provider_binding_id AND pb.agent_identity_id=a.agent_identity_id
   JOIN heartbeat_runs r ON r.company_id=c.id AND r.agent_id=a.id AND r.id=NEW.run_id
   JOIN orchestration_plans p ON p.company_id=c.id AND p.id=NEW.plan_id
   JOIN issues i ON i.company_id=c.id AND i.id=p.issue_id
   WHERE d.company_id=NEW.company_id AND d.id=NEW.draft_id AND d.created_by_user_id=NEW.created_by_user_id
     AND d.status='draft' AND d.version=NEW.draft_version AND d.content IS NOT NULL
     AND c.status='active' AND u.email_verified AND m.status='active'
     AND a.id=NEW.agent_id AND a.status IN ('idle','paused') AND a.adapter_type='paperclip_runner'
     AND rb.id=NEW.runtime_binding_id AND rb.provider_binding_id=NEW.provider_binding_id
     AND rb.status='active' AND pb.status='active' AND d.content->>'runtimeBindingId'=rb.id::text
     AND length(d.content->'scenarios'->>NEW.scenario_index)>0
     AND r.status='running' AND r.responsible_user_id=NEW.created_by_user_id AND r.trigger_detail='agent_safe_test'
     AND r.context_snapshot->>'agentConfigurationTestId'=NEW.id::text
     AND r.context_snapshot->>'candidateHash'=NEW.candidate_hash
     AND r.context_snapshot->>'toolsGranted'='false' AND r.context_snapshot->>'activatesAgent'='false'
     AND p.status='paused' AND p.erased_at IS NULL AND p.action_class='internal_draft' AND p.risk_class='C0'
     AND p.created_by=NEW.created_by_user_id AND p.execution_principal->>'type'='user'
     AND p.execution_principal->>'userId'=NEW.created_by_user_id AND p.started_at IS NOT NULL
     AND (p.budgets->>'maxModelCostMinor')::int=NEW.maximum_cost_minor AND (p.budgets->>'maxToolActions')::int=0
     AND p.tool_actions_used=0 AND p.verification_mode='independent_required' AND p.human_oversight_mode='required'
     AND i.hidden_at IS NOT NULL AND i.harness_kind='agent_safe_test' AND i.assignee_user_id=NEW.created_by_user_id AND i.assignee_agent_id IS NULL
     AND NOT EXISTS(SELECT 1 FROM orchestration_workers w WHERE w.company_id=c.id AND w.plan_id=p.id)
 ) THEN RAISE EXCEPTION 'agent_test_original_scope_required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v9_agent_test_guard BEFORE INSERT OR UPDATE OR DELETE ON agent_configuration_tests FOR EACH ROW EXECUTE FUNCTION aw_v9_agent_test_guard();
--> statement-breakpoint
CREATE FUNCTION aw_v9_agent_test_model_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
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
     AND d.status='draft' AND d.version=t.draft_version AND d.created_by_user_id=t.created_by_user_id
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
--> statement-breakpoint
CREATE TRIGGER aw_v9_agent_test_model_guard BEFORE INSERT OR UPDATE ON orchestration_model_reservations FOR EACH ROW EXECUTE FUNCTION aw_v9_agent_test_model_guard();
