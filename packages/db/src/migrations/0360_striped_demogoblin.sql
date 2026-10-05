CREATE TABLE "orchestration_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"completion_contract_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"action_class" text NOT NULL,
	"risk_class" text NOT NULL,
	"supervision_mode" text NOT NULL,
	"verification_mode" text NOT NULL,
	"human_oversight_mode" text NOT NULL,
	"workflow_id" uuid,
	"workflow_revision_id" uuid,
	"accepted_plan_revision_id" uuid,
	"budgets" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"retries_used" integer DEFAULT 0 NOT NULL,
	"tool_actions_used" integer DEFAULT 0 NOT NULL,
	"model_cost_reserved" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"erased_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orchestration_plan_tenant_uq" UNIQUE("company_id","id"),
	CONSTRAINT "orchestration_plan_status_check" CHECK ("orchestration_plans"."status" in ('draft','ready','running','paused','verifying','completed','cancelled','failed')),
	CONSTRAINT "orchestration_plan_mode_check" CHECK ("orchestration_plans"."mode" in ('single_worker','planned_parallel','workflow_bound','supervised_worker','supervised_parallel')),
	CONSTRAINT "orchestration_plan_risk_check" CHECK ("orchestration_plans"."risk_class" in ('C0','C1','C2','C3','C4')),
	CONSTRAINT "orchestration_plan_counter_check" CHECK ("orchestration_plans"."version">0 and "orchestration_plans"."retries_used">=0 and "orchestration_plans"."tool_actions_used">=0 and "orchestration_plans"."model_cost_reserved">=0),
	CONSTRAINT "orchestration_plan_action_check" CHECK ("orchestration_plans"."action_class" in ('internal_draft','external_communication','data_mutation','financial_commitment','person_decision','destructive_action','restricted_processing')),
	CONSTRAINT "orchestration_plan_budget_check" CHECK (coalesce(jsonb_typeof("orchestration_plans"."budgets")='object'
    and ("orchestration_plans"."budgets"->>'maxWorkerCount')::int between 1 and 32
    and ("orchestration_plans"."budgets"->>'maxParallelWorkers')::int between 1 and least(16,("orchestration_plans"."budgets"->>'maxWorkerCount')::int)
    and ("orchestration_plans"."budgets"->>'maxDelegationDepth')::int between 0 and 8
    and ("orchestration_plans"."budgets"->>'maxRetries')::int between 0 and 20
    and ("orchestration_plans"."budgets"->>'maxWallClockSeconds')::int between 30 and 86400
    and ("orchestration_plans"."budgets"->>'maxToolActions')::int between 0 and 10000
    and ("orchestration_plans"."budgets"->'maxModelCostMinor'='null'::jsonb or ("orchestration_plans"."budgets"->>'maxModelCostMinor')::int between 0 and 1000000)
    and "orchestration_plans"."budgets" ?& array['maxWorkerCount','maxParallelWorkers','maxDelegationDepth','maxRetries','maxWallClockSeconds','maxToolActions','maxModelCostMinor'],false))
);
--> statement-breakpoint
CREATE TABLE "orchestration_tool_charges" (
	"invocation_id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orchestration_worker_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"worker_id" uuid NOT NULL,
	"agent_id" uuid,
	"run_id" uuid,
	"workflow_run_id" uuid,
	"attempt" integer NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"execution_manifest_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orchestration_worker_attempt_number_uq" UNIQUE("worker_id","attempt"),
	CONSTRAINT "orchestration_worker_attempt_run_uq" UNIQUE("company_id","run_id"),
	CONSTRAINT "orchestration_worker_attempt_workflow_uq" UNIQUE("company_id","workflow_run_id"),
	CONSTRAINT "orchestration_attempt_kind_check" CHECK (num_nonnulls("orchestration_worker_attempts"."run_id","orchestration_worker_attempts"."workflow_run_id")=1 and ("orchestration_worker_attempts"."run_id" is null or "orchestration_worker_attempts"."agent_id" is not null)),
	CONSTRAINT "orchestration_attempt_state_check" CHECK ("orchestration_worker_attempts"."status" in ('running','succeeded','failed','cancelled')),
	CONSTRAINT "orchestration_attempt_number_check" CHECK ("orchestration_worker_attempts"."attempt">0)
);
--> statement-breakpoint
CREATE TABLE "orchestration_workers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"agent_id" uuid,
	"completion_contract_id" uuid NOT NULL,
	"worker_key" text NOT NULL,
	"depends_on" jsonb NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orchestration_worker_tenant_uq" UNIQUE("company_id","id"),
	CONSTRAINT "orchestration_worker_plan_id_uq" UNIQUE("company_id","plan_id","id"),
	CONSTRAINT "orchestration_worker_key_uq" UNIQUE("plan_id","worker_key"),
	CONSTRAINT "orchestration_worker_plan_task_uq" UNIQUE("plan_id","issue_id"),
	CONSTRAINT "orchestration_worker_state_check" CHECK ("orchestration_workers"."status" in ('waiting','running','completed','failed','cancelled')),
	CONSTRAINT "orchestration_worker_counter_check" CHECK ("orchestration_workers"."attempt_count">=0)
);
--> statement-breakpoint
ALTER TABLE "orchestration_plans" ADD CONSTRAINT "orchestration_plans_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orchestration_plans" ADD CONSTRAINT "orchestration_plans_company_id_issue_id_issues_company_id_id_fk" FOREIGN KEY ("company_id","issue_id") REFERENCES "public"."issues"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orchestration_plans" ADD CONSTRAINT "orchestration_plans_company_id_issue_id_completion_contract_id_completion_contracts_company_id_issue_id_id_fk" FOREIGN KEY ("company_id","issue_id","completion_contract_id") REFERENCES "public"."completion_contracts"("company_id","issue_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_revisions" ADD CONSTRAINT "workflow_revisions_company_workflow_id_uq" UNIQUE("company_id","workflow_id","id");
--> statement-breakpoint
ALTER TABLE "orchestration_plans" ADD CONSTRAINT "orchestration_plans_company_id_workflow_id_workflow_revision_id_workflow_revisions_company_id_workflow_id_id_fk" FOREIGN KEY ("company_id","workflow_id","workflow_revision_id") REFERENCES "public"."workflow_revisions"("company_id","workflow_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orchestration_plans" ADD CONSTRAINT "orchestration_plans_company_id_accepted_plan_revision_id_document_revisions_company_id_id_fk" FOREIGN KEY ("company_id","accepted_plan_revision_id") REFERENCES "public"."document_revisions"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orchestration_plans" ADD CONSTRAINT "orchestration_plans_company_id_workflow_id_workflows_company_id_id_fk" FOREIGN KEY ("company_id","workflow_id") REFERENCES "public"."workflows"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orchestration_tool_charges" ADD CONSTRAINT "orchestration_tool_charges_invocation_id_tool_invocations_id_fk" FOREIGN KEY ("invocation_id") REFERENCES "public"."tool_invocations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orchestration_tool_charges" ADD CONSTRAINT "orchestration_tool_charges_company_id_plan_id_orchestration_plans_company_id_id_fk" FOREIGN KEY ("company_id","plan_id") REFERENCES "public"."orchestration_plans"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orchestration_worker_attempts" ADD CONSTRAINT "orchestration_worker_attempts_company_id_plan_id_worker_id_orchestration_workers_company_id_plan_id_id_fk" FOREIGN KEY ("company_id","plan_id","worker_id") REFERENCES "public"."orchestration_workers"("company_id","plan_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orchestration_worker_attempts" ADD CONSTRAINT "orchestration_worker_attempts_company_id_agent_id_run_id_heartbeat_runs_company_id_agent_id_id_fk" FOREIGN KEY ("company_id","agent_id","run_id") REFERENCES "public"."heartbeat_runs"("company_id","agent_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orchestration_worker_attempts" ADD CONSTRAINT "orchestration_worker_attempts_company_id_workflow_run_id_workflow_runs_company_id_id_fk" FOREIGN KEY ("company_id","workflow_run_id") REFERENCES "public"."workflow_runs"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orchestration_worker_attempts" ADD CONSTRAINT "orchestration_worker_attempts_company_id_execution_manifest_id_agent_execution_manifests_company_id_id_fk" FOREIGN KEY ("company_id","execution_manifest_id") REFERENCES "public"."agent_execution_manifests"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orchestration_workers" ADD CONSTRAINT "orchestration_workers_company_id_issue_id_completion_contract_id_completion_contracts_company_id_issue_id_id_fk" FOREIGN KEY ("company_id","issue_id","completion_contract_id") REFERENCES "public"."completion_contracts"("company_id","issue_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orchestration_workers" ADD CONSTRAINT "orchestration_workers_company_id_plan_id_orchestration_plans_company_id_id_fk" FOREIGN KEY ("company_id","plan_id") REFERENCES "public"."orchestration_plans"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orchestration_workers" ADD CONSTRAINT "orchestration_workers_company_id_issue_id_issues_company_id_id_fk" FOREIGN KEY ("company_id","issue_id") REFERENCES "public"."issues"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orchestration_workers" ADD CONSTRAINT "orchestration_workers_company_id_agent_id_agents_company_id_id_fk" FOREIGN KEY ("company_id","agent_id") REFERENCES "public"."agents"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "orchestration_plan_live_task_uq" ON "orchestration_plans" USING btree ("company_id","issue_id") WHERE "orchestration_plans"."status" not in ('completed','cancelled','failed');--> statement-breakpoint
CREATE INDEX "orchestration_plan_company_idx" ON "orchestration_plans" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "orchestration_worker_attempt_live_uq" ON "orchestration_worker_attempts" USING btree ("worker_id") WHERE "orchestration_worker_attempts"."status"='running';--> statement-breakpoint
CREATE UNIQUE INDEX "orchestration_worker_live_task_uq" ON "orchestration_workers" USING btree ("company_id","issue_id") WHERE "orchestration_workers"."status" in ('waiting','running');--> statement-breakpoint
-- Platform-side admission remains authoritative with feature flags disabled.
CREATE OR REPLACE FUNCTION aw_v7_orchestration_tool_charge() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bound_plan uuid; plan_row orchestration_plans%ROWTYPE; charged uuid; flags jsonb;
BEGIN
  IF NEW.status <> 'executing' OR (TG_OP = 'UPDATE' AND OLD.status = 'executing') THEN RETURN NEW; END IF;
  WITH RECURSIVE lineage AS (
    SELECT wr.id, wr.parent_workflow_run_id, 0 AS depth FROM workflow_runs wr
    WHERE wr.company_id = NEW.company_id AND (wr.id = NEW.workflow_run_id OR wr.id IN (
      SELECT s.workflow_run_id FROM workflow_step_runs s WHERE s.company_id = NEW.company_id AND s.heartbeat_run_id = NEW.run_id))
    UNION ALL
    SELECT wr.id, wr.parent_workflow_run_id, l.depth + 1 FROM workflow_runs wr JOIN lineage l ON wr.id = l.parent_workflow_run_id
    WHERE wr.company_id = NEW.company_id AND l.depth < 64
  )
  SELECT a.plan_id INTO bound_plan FROM orchestration_worker_attempts a
  WHERE a.company_id = NEW.company_id AND (a.run_id = NEW.run_id OR a.workflow_run_id IN (SELECT id FROM lineage)) LIMIT 1;
  IF bound_plan IS NULL THEN
    IF EXISTS(SELECT 1 FROM orchestration_workers w JOIN orchestration_plans active_plan ON active_plan.company_id = w.company_id AND active_plan.id = w.plan_id
      WHERE w.company_id = NEW.company_id AND w.issue_id = NEW.issue_id AND active_plan.status NOT IN ('completed','cancelled','failed'))
    THEN RAISE EXCEPTION 'orchestration_tool_requires_admitted_attempt' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO plan_row FROM orchestration_plans WHERE company_id = NEW.company_id AND id = bound_plan FOR UPDATE;
  SELECT experimental INTO flags FROM instance_settings WHERE singleton_key = 'default';
  IF plan_row.status <> 'running' OR plan_row.erased_at IS NOT NULL OR plan_row.started_at IS NULL
    OR clock_timestamp() >= plan_row.started_at + make_interval(secs => (plan_row.budgets->>'maxWallClockSeconds')::int)
    OR NOT (coalesce(flags,'{}'::jsonb) @> '{"orchestration_v7":true,"readiness_engine_v7":true,"enableWorkflowsV1":true,"enableFoundationV1":true,"enableContextEngineV1":true,"agent_runtime_fabric_v5":true,"agent_identities_v5":true,"agent_provider_bindings_v5":true}'::jsonb)
  THEN RAISE EXCEPTION 'orchestration_execution_not_authorized' USING ERRCODE = '23514'; END IF;
  IF NEW.run_id IS NOT NULL AND EXISTS(SELECT 1 FROM orchestration_worker_attempts a WHERE a.company_id=NEW.company_id AND a.run_id=NEW.run_id) THEN
    IF NOT EXISTS(SELECT 1 FROM orchestration_worker_attempts a JOIN heartbeat_runs r ON r.company_id=a.company_id AND r.id=a.run_id JOIN orchestration_workers w ON w.company_id=a.company_id AND w.id=a.worker_id JOIN issues t ON t.company_id=w.company_id AND t.id=w.issue_id
      WHERE a.company_id=NEW.company_id AND a.run_id=NEW.run_id AND a.status='running' AND r.status='running' AND t.status NOT IN ('done','cancelled') AND t.assignee_agent_id=w.agent_id AND r.agent_id=w.agent_id AND coalesce(r.result_json->'executionCancellation'->>'state','') <> 'requested')
    THEN RAISE EXCEPTION 'orchestration_attempt_stopped' USING ERRCODE = '23514'; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM orchestration_tool_charges WHERE invocation_id = NEW.id) THEN RETURN NEW; END IF;
  IF plan_row.tool_actions_used >= (plan_row.budgets->>'maxToolActions')::int THEN RAISE EXCEPTION 'orchestration_tool_budget_exhausted' USING ERRCODE = '23514'; END IF;
  INSERT INTO orchestration_tool_charges(invocation_id, company_id, plan_id) VALUES(NEW.id, NEW.company_id, plan_row.id) ON CONFLICT DO NOTHING RETURNING invocation_id INTO charged;
  IF charged IS NOT NULL THEN UPDATE orchestration_plans SET tool_actions_used = tool_actions_used + 1, updated_at = clock_timestamp() WHERE id = plan_row.id; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER aw_v7_orchestration_tool_charge_insert AFTER INSERT ON tool_invocations FOR EACH ROW EXECUTE FUNCTION aw_v7_orchestration_tool_charge();
--> statement-breakpoint
CREATE TRIGGER aw_v7_orchestration_tool_charge_update BEFORE UPDATE OF status ON tool_invocations FOR EACH ROW EXECUTE FUNCTION aw_v7_orchestration_tool_charge();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v7_orchestration_task_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.parent_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM orchestration_plans p WHERE p.company_id = NEW.company_id AND p.status NOT IN ('completed','cancelled','failed')
      AND (p.issue_id = NEW.parent_id OR p.id IN (SELECT w.plan_id FROM orchestration_workers w WHERE w.company_id = NEW.company_id AND w.issue_id = NEW.parent_id)))
    THEN RAISE EXCEPTION 'orchestration_requires_explicit_worker_plan' USING ERRCODE = '23514'; END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status = 'done' AND OLD.status <> 'done' THEN
    IF EXISTS (SELECT 1 FROM orchestration_plans p WHERE p.company_id = NEW.company_id AND p.issue_id = NEW.id AND p.status NOT IN ('completed','cancelled','failed'))
      OR EXISTS (SELECT 1 FROM orchestration_workers w JOIN orchestration_plans p ON p.company_id = w.company_id AND p.id = w.plan_id
        WHERE w.company_id = NEW.company_id AND w.issue_id = NEW.id AND p.status NOT IN ('completed','cancelled','failed') AND w.status <> 'completed')
    THEN RAISE EXCEPTION 'orchestration_completion_requires_server_verification' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER aw_v7_orchestration_task_insert BEFORE INSERT ON issues FOR EACH ROW EXECUTE FUNCTION aw_v7_orchestration_task_guard();
--> statement-breakpoint
CREATE TRIGGER aw_v7_orchestration_task_complete BEFORE UPDATE OF status ON issues FOR EACH ROW EXECUTE FUNCTION aw_v7_orchestration_task_guard();

--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v7_orchestration_plan_pin_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.company_id,NEW.issue_id,NEW.completion_contract_id,NEW.mode,NEW.risk_class,NEW.action_class,NEW.workflow_id,NEW.workflow_revision_id,NEW.accepted_plan_revision_id,NEW.budgets)
    IS DISTINCT FROM (OLD.company_id,OLD.issue_id,OLD.completion_contract_id,OLD.mode,OLD.risk_class,OLD.action_class,OLD.workflow_id,OLD.workflow_revision_id,OLD.accepted_plan_revision_id,OLD.budgets)
    OR (OLD.started_at IS NOT NULL AND NEW.started_at IS DISTINCT FROM OLD.started_at)
    OR NEW.retries_used < OLD.retries_used OR NEW.tool_actions_used < OLD.tool_actions_used
  THEN RAISE EXCEPTION 'orchestration_requires_new_versioned_plan' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER aw_v7_orchestration_plan_pin_guard BEFORE UPDATE ON orchestration_plans FOR EACH ROW EXECUTE FUNCTION aw_v7_orchestration_plan_pin_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v7_orchestration_contract_erasure() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE affected_plan uuid;
BEGIN
  IF coalesce(NEW.contract_json->>'payloadDeleted','') <> 'true' THEN RETURN NEW; END IF;
  FOR affected_plan IN SELECT p.id FROM orchestration_plans p WHERE p.company_id=NEW.company_id
    AND (p.completion_contract_id=NEW.id OR p.id IN (SELECT w.plan_id FROM orchestration_workers w WHERE w.company_id=NEW.company_id AND w.completion_contract_id=NEW.id))
  LOOP
    UPDATE orchestration_plans SET status=CASE WHEN status IN ('completed','cancelled','failed') THEN status ELSE 'failed' END,
      erased_at=coalesce(erased_at,clock_timestamp()), updated_at=clock_timestamp(), version=version+1 WHERE id=affected_plan;
    UPDATE orchestration_workers SET status='cancelled', updated_at=clock_timestamp() WHERE plan_id=affected_plan AND status IN ('waiting','running');
  END LOOP;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER aw_v7_orchestration_contract_erasure AFTER UPDATE OF contract_json ON completion_contracts FOR EACH ROW EXECUTE FUNCTION aw_v7_orchestration_contract_erasure();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v7_orchestration_worker_pin_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE budget integer; peer_count integer; plan_state text;
BEGIN
  SELECT status, (budgets->>'maxWorkerCount')::int INTO plan_state,budget FROM orchestration_plans WHERE company_id=NEW.company_id AND id=NEW.plan_id FOR UPDATE;
  IF TG_OP='INSERT' THEN
    SELECT count(*) INTO peer_count FROM orchestration_workers WHERE company_id=NEW.company_id AND plan_id=NEW.plan_id;
    IF plan_state<>'draft' OR peer_count>=budget THEN RAISE EXCEPTION 'orchestration_worker_budget_or_plan_closed' USING ERRCODE='23514'; END IF;
  ELSE
    IF (NEW.company_id,NEW.plan_id,NEW.issue_id,NEW.completion_contract_id,NEW.worker_key,NEW.depends_on) IS DISTINCT FROM
      (OLD.company_id,OLD.plan_id,OLD.issue_id,OLD.completion_contract_id,OLD.worker_key,OLD.depends_on) OR NEW.attempt_count<OLD.attempt_count
    THEN RAISE EXCEPTION 'orchestration_worker_requires_new_plan' USING ERRCODE='23514'; END IF;
    IF NEW.agent_id IS DISTINCT FROM OLD.agent_id AND (plan_state<>'paused' OR EXISTS(SELECT 1 FROM orchestration_worker_attempts WHERE worker_id=NEW.id AND status='running')
      OR NOT EXISTS(SELECT 1 FROM issues WHERE company_id=NEW.company_id AND id=NEW.issue_id AND assignee_agent_id=NEW.agent_id))
    THEN RAISE EXCEPTION 'orchestration_reassignment_not_authorized' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER aw_v7_orchestration_worker_pin_guard BEFORE INSERT OR UPDATE ON orchestration_workers FOR EACH ROW EXECUTE FUNCTION aw_v7_orchestration_worker_pin_guard();
