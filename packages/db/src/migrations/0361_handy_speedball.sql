CREATE TABLE "supervision_interventions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"signal_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recommendation" text NOT NULL,
	"decision_action" text NOT NULL,
	"reason_code" text NOT NULL,
	"policy_snapshot_hash" text NOT NULL,
	"expected_plan_version" integer NOT NULL,
	"requested_by_type" text NOT NULL,
	"requested_by_id" text,
	"rationale" text,
	"target_worker_id" uuid,
	"target_agent_id" uuid,
	"target_attempt_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "supervision_intervention_tenant_uq" UNIQUE("company_id","id"),
	CONSTRAINT "supervision_intervention_idempotency_uq" UNIQUE("company_id","idempotency_key"),
	CONSTRAINT "supervision_intervention_action_check" CHECK ("supervision_interventions"."recommendation" in ('CONTINUE','STEER','PAUSE','RETRY','REASSIGN','SPAWN_WORKER','START_VERIFIER','REQUEST_INPUT','REQUEST_APPROVAL','ESCALATE_HUMAN','STOP','FINISH') and "supervision_interventions"."decision_action" in ('CONTINUE','STEER','PAUSE','RETRY','REASSIGN','SPAWN_WORKER','START_VERIFIER','REQUEST_INPUT','REQUEST_APPROVAL','ESCALATE_HUMAN','STOP','FINISH')),
	CONSTRAINT "supervision_intervention_state_check" CHECK ("supervision_interventions"."status" in ('pending','running','applied','blocked','failed')),
	CONSTRAINT "supervision_intervention_actor_check" CHECK ("supervision_interventions"."requested_by_type" in ('user','agent','system')),
	CONSTRAINT "supervision_intervention_lease_check" CHECK (("supervision_interventions"."lease_owner" is null)=("supervision_interventions"."lease_expires_at" is null) and ("supervision_interventions"."status"='running')=("supervision_interventions"."lease_owner" is not null)),
	CONSTRAINT "supervision_intervention_counter_check" CHECK ("supervision_interventions"."attempts">=0 and "supervision_interventions"."expected_plan_version">0)
);
--> statement-breakpoint
CREATE TABLE "supervision_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"policy" jsonb NOT NULL,
	"progress_hash" text,
	"last_progress_at" timestamp with time zone,
	"checks_used" integer DEFAULT 0 NOT NULL,
	"verifier_calls_used" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_observed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supervision_session_tenant_uq" UNIQUE("company_id","id"),
	CONSTRAINT "supervision_plan_session_uq" UNIQUE("company_id","plan_id","id"),
	CONSTRAINT "supervision_session_status_check" CHECK ("supervision_sessions"."status" in ('active','paused','completed','failed')),
	CONSTRAINT "supervision_session_counters_check" CHECK ("supervision_sessions"."checks_used">=0 and "supervision_sessions"."verifier_calls_used">=0)
);
--> statement-breakpoint
CREATE TABLE "supervision_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"worker_attempt_id" uuid,
	"signal_type" text NOT NULL,
	"severity" text NOT NULL,
	"source_type" text NOT NULL,
	"source_ref" text NOT NULL,
	"facts" jsonb NOT NULL,
	"snapshot_hash" text NOT NULL,
	"dedup_key" text NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "supervision_signal_tenant_uq" UNIQUE("company_id","id"),
	CONSTRAINT "supervision_signal_dedup_uq" UNIQUE("company_id","plan_id","dedup_key"),
	CONSTRAINT "supervision_signal_type_check" CHECK ("supervision_signals"."signal_type" in ('progress','no_progress','stuck_loop','repeated_failure','off_track','requirement_missing','requirement_satisfied','verification_needed','verification_failed','budget_warning','budget_exceeded','permission_changed','readiness_degraded','external_dependency_wait','human_input_needed','policy_violation','possible_completion')),
	CONSTRAINT "supervision_signal_severity_check" CHECK ("supervision_signals"."severity" in ('info','warning','blocking'))
);
--> statement-breakpoint
ALTER TABLE "orchestration_plans" ADD COLUMN "supervision_policy" jsonb DEFAULT '{"repeatedFailureThreshold":3,"noProgressSeconds":null,"minCheckIntervalSeconds":30,"maxSupervisorChecks":100,"maxVerifierCalls":1,"maxVerificationDepth":1}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "orchestration_plans" ADD COLUMN "execution_principal" jsonb;--> statement-breakpoint
ALTER TABLE "orchestration_plans" ADD COLUMN "supervisor_checks_used" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orchestration_plans" ADD COLUMN "verifier_calls_used" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "supervision_interventions" ADD CONSTRAINT "supervision_interventions_company_id_plan_id_session_id_supervision_sessions_company_id_plan_id_id_fk" FOREIGN KEY ("company_id","plan_id","session_id") REFERENCES "public"."supervision_sessions"("company_id","plan_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supervision_interventions" ADD CONSTRAINT "supervision_interventions_company_id_plan_id_target_worker_id_orchestration_workers_company_id_plan_id_id_fk" FOREIGN KEY ("company_id","plan_id","target_worker_id") REFERENCES "public"."orchestration_workers"("company_id","plan_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supervision_interventions" ADD CONSTRAINT "supervision_interventions_company_id_target_agent_id_agents_company_id_id_fk" FOREIGN KEY ("company_id","target_agent_id") REFERENCES "public"."agents"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supervision_sessions" ADD CONSTRAINT "supervision_sessions_company_id_plan_id_orchestration_plans_company_id_id_fk" FOREIGN KEY ("company_id","plan_id") REFERENCES "public"."orchestration_plans"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orchestration_worker_attempts" ADD CONSTRAINT "orchestration_attempt_plan_id_uq" UNIQUE("company_id","plan_id","id");
--> statement-breakpoint
ALTER TABLE "supervision_signals" ADD CONSTRAINT "supervision_signals_company_id_plan_id_session_id_supervision_sessions_company_id_plan_id_id_fk" FOREIGN KEY ("company_id","plan_id","session_id") REFERENCES "public"."supervision_sessions"("company_id","plan_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supervision_signals" ADD CONSTRAINT "supervision_signals_company_id_plan_id_worker_attempt_id_orchestration_worker_attempts_company_id_plan_id_id_fk" FOREIGN KEY ("company_id","plan_id","worker_attempt_id") REFERENCES "public"."orchestration_worker_attempts"("company_id","plan_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supervision_intervention_queue_idx" ON "supervision_interventions" USING btree ("status","lease_expires_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "supervision_session_live_plan_uq" ON "supervision_sessions" USING btree ("plan_id") WHERE "supervision_sessions"."status"='active';--> statement-breakpoint
CREATE INDEX "supervision_signal_plan_idx" ON "supervision_signals" USING btree ("company_id","plan_id","observed_at");--> statement-breakpoint
ALTER TABLE "orchestration_plans" ADD CONSTRAINT "orchestration_supervision_budget_check" CHECK (coalesce(
    ("orchestration_plans"."supervision_policy"->>'maxSupervisorChecks')::int between 1 and 10000
    and ("orchestration_plans"."supervision_policy"->>'maxVerifierCalls')::int between 0 and 10
    and ("orchestration_plans"."supervision_policy"->>'maxVerificationDepth')::int between 0 and 3
    and ("orchestration_plans"."supervision_policy"->>'repeatedFailureThreshold')::int between 2 and 20
    and ("orchestration_plans"."supervision_policy"->>'minCheckIntervalSeconds')::int between 5 and 3600
    and ("orchestration_plans"."supervision_policy"->'noProgressSeconds'='null'::jsonb or ("orchestration_plans"."supervision_policy"->>'noProgressSeconds')::int between 30 and 86400)
    and "orchestration_plans"."supervisor_checks_used" between 0 and ("orchestration_plans"."supervision_policy"->>'maxSupervisorChecks')::int
    and "orchestration_plans"."verifier_calls_used" between 0 and ("orchestration_plans"."supervision_policy"->>'maxVerifierCalls')::int,false));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v7_orchestration_plan_pin_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.company_id,NEW.issue_id,NEW.completion_contract_id,NEW.mode,NEW.risk_class,NEW.action_class,NEW.workflow_id,NEW.workflow_revision_id,NEW.accepted_plan_revision_id,NEW.budgets,NEW.supervision_policy)
    IS DISTINCT FROM (OLD.company_id,OLD.issue_id,OLD.completion_contract_id,OLD.mode,OLD.risk_class,OLD.action_class,OLD.workflow_id,OLD.workflow_revision_id,OLD.accepted_plan_revision_id,OLD.budgets,OLD.supervision_policy)
    OR (OLD.started_at IS NOT NULL AND NEW.started_at IS DISTINCT FROM OLD.started_at)
    OR (OLD.execution_principal IS NOT NULL AND NEW.execution_principal IS DISTINCT FROM OLD.execution_principal)
    OR (OLD.execution_principal IS NULL AND NEW.execution_principal IS NOT NULL AND (NEW.status<>'running' OR NEW.started_at IS NULL OR NOT (NEW.execution_principal->>'type'='user' OR NEW.execution_principal @> '{"type":"system","service":"local-board"}'::jsonb)))
    OR NEW.supervisor_checks_used<OLD.supervisor_checks_used OR NEW.verifier_calls_used<OLD.verifier_calls_used
    OR NEW.retries_used < OLD.retries_used OR NEW.tool_actions_used < OLD.tool_actions_used
  THEN RAISE EXCEPTION 'orchestration_requires_new_versioned_plan' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;

--> statement-breakpoint
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
  IF NEW.risk_level IN ('write','destructive') AND NEW.approval_state<>'approved' THEN RAISE EXCEPTION 'orchestration_material_tool_requires_approval' USING ERRCODE='23514'; END IF;
  IF EXISTS (SELECT 1 FROM orchestration_tool_charges WHERE invocation_id = NEW.id) THEN RETURN NEW; END IF;
  IF plan_row.tool_actions_used >= (plan_row.budgets->>'maxToolActions')::int THEN RAISE EXCEPTION 'orchestration_tool_budget_exhausted' USING ERRCODE = '23514'; END IF;
  INSERT INTO orchestration_tool_charges(invocation_id, company_id, plan_id) VALUES(NEW.id, NEW.company_id, plan_row.id) ON CONFLICT DO NOTHING RETURNING invocation_id INTO charged;
  IF charged IS NOT NULL THEN UPDATE orchestration_plans SET tool_actions_used = tool_actions_used + 1, updated_at = clock_timestamp() WHERE id = plan_row.id; END IF;
  RETURN NEW;
END;
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v7_supervision_session_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.company_id,NEW.plan_id,NEW.policy,NEW.started_at) IS DISTINCT FROM (OLD.company_id,OLD.plan_id,OLD.policy,OLD.started_at)
   OR NEW.checks_used<OLD.checks_used OR NEW.verifier_calls_used<OLD.verifier_calls_used
 THEN RAISE EXCEPTION 'supervision_session_pins_immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER aw_v7_supervision_session_guard BEFORE UPDATE ON supervision_sessions FOR EACH ROW EXECUTE FUNCTION aw_v7_supervision_session_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v7_orchestration_topology_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.parent_id,NEW.project_id,NEW.request_depth) IS DISTINCT FROM (OLD.parent_id,OLD.project_id,OLD.request_depth) AND (
 EXISTS(SELECT 1 FROM orchestration_workers w JOIN orchestration_plans p ON p.company_id=w.company_id AND p.id=w.plan_id WHERE w.company_id=NEW.company_id AND w.issue_id=NEW.id AND p.status NOT IN ('completed','cancelled','failed'))
 OR EXISTS(SELECT 1 FROM orchestration_plans p WHERE p.company_id=NEW.company_id AND p.status NOT IN ('completed','cancelled','failed') AND (p.issue_id=NEW.parent_id OR p.id IN(SELECT w.plan_id FROM orchestration_workers w WHERE w.company_id=NEW.company_id AND w.issue_id=NEW.parent_id))))
 THEN RAISE EXCEPTION 'orchestration_topology_requires_new_plan' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER aw_v7_orchestration_topology_guard BEFORE UPDATE OF parent_id,project_id,request_depth ON issues FOR EACH ROW EXECUTE FUNCTION aw_v7_orchestration_topology_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v7_supervision_erasure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.erased_at IS NOT NULL THEN
   UPDATE supervision_interventions SET rationale=NULL WHERE company_id=NEW.company_id AND plan_id=NEW.id;
 END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER aw_v7_supervision_erasure AFTER UPDATE OF erased_at ON orchestration_plans FOR EACH ROW EXECUTE FUNCTION aw_v7_supervision_erasure();

--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v7_supervision_intervention_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM orchestration_plans WHERE company_id=NEW.company_id AND id=NEW.plan_id AND erased_at IS NOT NULL) THEN NEW.rationale=NULL; END IF;
 IF TG_OP='UPDATE' AND ((NEW.company_id,NEW.plan_id,NEW.session_id,NEW.recommendation,NEW.decision_action,NEW.signal_ids,NEW.policy_snapshot_hash,NEW.expected_plan_version,NEW.requested_by_type,NEW.requested_by_id,NEW.target_worker_id,NEW.target_agent_id,NEW.target_attempt_ids,NEW.idempotency_key) IS DISTINCT FROM
 (OLD.company_id,OLD.plan_id,OLD.session_id,OLD.recommendation,OLD.decision_action,OLD.signal_ids,OLD.policy_snapshot_hash,OLD.expected_plan_version,OLD.requested_by_type,OLD.requested_by_id,OLD.target_worker_id,OLD.target_agent_id,OLD.target_attempt_ids,OLD.idempotency_key) OR NEW.attempts<OLD.attempts)
 THEN RAISE EXCEPTION 'supervision_intervention_pins_immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER aw_v7_supervision_intervention_guard BEFORE INSERT OR UPDATE ON supervision_interventions FOR EACH ROW EXECUTE FUNCTION aw_v7_supervision_intervention_guard();
