-- Composite referenced keys must exist before their foreign keys are installed.
ALTER TABLE "orchestration_model_reservations" DROP CONSTRAINT "orchestration_model_reservation_scope_ck";
--> statement-breakpoint
ALTER TABLE "orchestration_model_reservations" DROP CONSTRAINT "orchestration_model_reservation_purpose_ck";
--> statement-breakpoint
ALTER TABLE "orchestration_model_reservations" ADD COLUMN "review_issue_id" uuid;
--> statement-breakpoint
ALTER TABLE "orchestration_model_reservations" ADD COLUMN "review_interaction_id" uuid;
--> statement-breakpoint
ALTER TABLE "orchestration_model_reservations" ADD COLUMN "review_decision_id" uuid;
--> statement-breakpoint
ALTER TABLE "orchestration_model_reservations" ADD COLUMN "review_source_run_id" uuid;
--> statement-breakpoint
ALTER TABLE "orchestration_model_reservations" ADD COLUMN "review_source_result_id" uuid;
--> statement-breakpoint
ALTER TABLE "orchestration_model_reservations" ADD COLUMN "review_source_worker_id" uuid;
--> statement-breakpoint
ALTER TABLE "orchestration_model_reservations" ADD COLUMN "review_source_agent_id" uuid;
--> statement-breakpoint
ALTER TABLE "orchestration_model_reservations" ADD COLUMN "review_source_attempt_id" uuid;
--> statement-breakpoint
ALTER TABLE "orchestration_model_reservations" ADD COLUMN "review_source_receipt_digest" text;
--> statement-breakpoint
ALTER TABLE "orchestration_model_reservations" ADD COLUMN "review_source_result_canonical_sha256" text;
--> statement-breakpoint
ALTER TABLE "orchestration_model_reservations" ADD COLUMN "review_agent_id" uuid;
--> statement-breakpoint
ALTER TABLE "orchestration_model_reservations" ADD COLUMN "review_run_id" uuid;
--> statement-breakpoint
ALTER TABLE "orchestration_model_reservations" ADD COLUMN "review_execution_manifest_id" uuid;
--> statement-breakpoint
ALTER TABLE "orchestration_model_reservations" ADD COLUMN "review_plan_version" integer;
--> statement-breakpoint
ALTER TABLE "agent_execution_manifests" ADD CONSTRAINT "agent_execution_manifests_company_agent_run_manifest_uq" UNIQUE("company_id","agent_id","run_id","id");
--> statement-breakpoint
ALTER TABLE "issue_thread_interactions" ADD CONSTRAINT "issue_thread_interactions_company_issue_id_uq" UNIQUE("company_id","issue_id","id");
--> statement-breakpoint
ALTER TABLE "orchestration_worker_attempts" ADD CONSTRAINT "orchestration_attempt_plan_worker_owner_uq" UNIQUE("company_id","plan_id","worker_id","id");
--> statement-breakpoint
ALTER TABLE "orchestration_model_reservations" ADD CONSTRAINT "orchestration_model_reservations_review_issue_fk" FOREIGN KEY ("company_id","review_issue_id") REFERENCES "public"."issues"("company_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "orchestration_model_reservations" ADD CONSTRAINT "orchestration_model_reservations_review_interaction_fk" FOREIGN KEY ("company_id","review_issue_id","review_interaction_id") REFERENCES "public"."issue_thread_interactions"("company_id","issue_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "orchestration_model_reservations" ADD CONSTRAINT "orchestration_model_reservations_review_decision_fk" FOREIGN KEY ("company_id","review_issue_id","review_decision_id") REFERENCES "public"."status_decisions"("company_id","issue_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "orchestration_model_reservations" ADD CONSTRAINT "orchestration_model_reservations_review_source_result_fk" FOREIGN KEY ("company_id","review_issue_id","review_source_run_id","review_source_result_id") REFERENCES "public"."native_run_results"("company_id","issue_id","run_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "orchestration_model_reservations" ADD CONSTRAINT "orchestration_model_reservations_review_source_run_fk" FOREIGN KEY ("company_id","review_source_agent_id","review_source_run_id") REFERENCES "public"."heartbeat_runs"("company_id","agent_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "orchestration_model_reservations" ADD CONSTRAINT "orchestration_model_reservations_review_source_attempt_fk" FOREIGN KEY ("company_id","plan_id","review_source_worker_id","review_source_attempt_id") REFERENCES "public"."orchestration_worker_attempts"("company_id","plan_id","worker_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "orchestration_model_reservations" ADD CONSTRAINT "orchestration_model_reservations_review_reviewer_run_fk" FOREIGN KEY ("company_id","review_agent_id","review_run_id") REFERENCES "public"."heartbeat_runs"("company_id","agent_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "orchestration_model_reservations" ADD CONSTRAINT "orchestration_model_reservations_review_manifest_fk" FOREIGN KEY ("company_id","review_agent_id","review_run_id","review_execution_manifest_id") REFERENCES "public"."agent_execution_manifests"("company_id","agent_id","run_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "orchestration_model_reservations" ADD CONSTRAINT "orchestration_model_reservation_scope_ck" CHECK ((
    "orchestration_model_reservations"."purpose"='conversation_model' and "orchestration_model_reservations"."plan_id" is null and "orchestration_model_reservations"."worker_id" is null and "orchestration_model_reservations"."worker_attempt_id" is null and
    "orchestration_model_reservations"."conversation_agent_id" is not null and "orchestration_model_reservations"."conversation_run_id" is not null and "orchestration_model_reservations"."conversation_issue_id" is not null and
    "orchestration_model_reservations"."conversation_session_generation" is not null and "orchestration_model_reservations"."conversation_session_generation">=0 and "orchestration_model_reservations"."execution_manifest_id" is not null and
    "orchestration_model_reservations"."execution_manifest_hash" is not null and "orchestration_model_reservations"."execution_manifest_hash" ~ '^[a-f0-9]{64}$' and "orchestration_model_reservations"."conversation_tariff_snapshot" is not null and jsonb_typeof("orchestration_model_reservations"."conversation_tariff_snapshot")='object' and
    "orchestration_model_reservations"."review_issue_id" is null and "orchestration_model_reservations"."review_interaction_id" is null and "orchestration_model_reservations"."review_decision_id" is null and "orchestration_model_reservations"."review_source_run_id" is null and "orchestration_model_reservations"."review_source_result_id" is null and
    "orchestration_model_reservations"."review_source_worker_id" is null and "orchestration_model_reservations"."review_source_agent_id" is null and "orchestration_model_reservations"."review_source_attempt_id" is null and "orchestration_model_reservations"."review_source_receipt_digest" is null and "orchestration_model_reservations"."review_source_result_canonical_sha256" is null and
    "orchestration_model_reservations"."review_agent_id" is null and "orchestration_model_reservations"."review_run_id" is null and "orchestration_model_reservations"."review_execution_manifest_id" is null and "orchestration_model_reservations"."review_plan_version" is null
  ) or (
    "orchestration_model_reservations"."purpose"='review_model' and "orchestration_model_reservations"."plan_id" is not null and "orchestration_model_reservations"."worker_id" is null and "orchestration_model_reservations"."worker_attempt_id" is null and
    "orchestration_model_reservations"."review_issue_id" is not null and "orchestration_model_reservations"."review_interaction_id" is not null and "orchestration_model_reservations"."review_decision_id" is not null and
    "orchestration_model_reservations"."review_source_run_id" is not null and "orchestration_model_reservations"."review_source_result_id" is not null and "orchestration_model_reservations"."review_source_worker_id" is not null and "orchestration_model_reservations"."review_source_agent_id" is not null and "orchestration_model_reservations"."review_source_attempt_id" is not null and "orchestration_model_reservations"."review_source_receipt_digest" is not null and "orchestration_model_reservations"."review_source_receipt_digest" ~ '^[a-f0-9]{64}$' and "orchestration_model_reservations"."review_source_result_canonical_sha256" is not null and "orchestration_model_reservations"."review_source_result_canonical_sha256" ~ '^sha256:[a-f0-9]{64}$' and
    "orchestration_model_reservations"."review_agent_id" is not null and "orchestration_model_reservations"."review_run_id" is not null and "orchestration_model_reservations"."review_execution_manifest_id" is not null and "orchestration_model_reservations"."review_plan_version" is not null and "orchestration_model_reservations"."review_plan_version">0 and
    "orchestration_model_reservations"."conversation_agent_id" is null and "orchestration_model_reservations"."conversation_run_id" is null and "orchestration_model_reservations"."conversation_issue_id" is null and
    "orchestration_model_reservations"."conversation_session_generation" is null and "orchestration_model_reservations"."execution_manifest_id" is null and "orchestration_model_reservations"."execution_manifest_hash" is null and "orchestration_model_reservations"."conversation_tariff_snapshot" is null
  ) or (
    "orchestration_model_reservations"."purpose" not in ('conversation_model','review_model') and "orchestration_model_reservations"."plan_id" is not null and "orchestration_model_reservations"."conversation_agent_id" is null and
    "orchestration_model_reservations"."conversation_run_id" is null and "orchestration_model_reservations"."conversation_issue_id" is null and "orchestration_model_reservations"."conversation_session_generation" is null and
    "orchestration_model_reservations"."execution_manifest_id" is null and "orchestration_model_reservations"."execution_manifest_hash" is null and "orchestration_model_reservations"."conversation_tariff_snapshot" is null and
    "orchestration_model_reservations"."review_issue_id" is null and "orchestration_model_reservations"."review_interaction_id" is null and "orchestration_model_reservations"."review_decision_id" is null and "orchestration_model_reservations"."review_source_run_id" is null and "orchestration_model_reservations"."review_source_result_id" is null and
    "orchestration_model_reservations"."review_source_worker_id" is null and "orchestration_model_reservations"."review_source_agent_id" is null and "orchestration_model_reservations"."review_source_attempt_id" is null and "orchestration_model_reservations"."review_source_receipt_digest" is null and "orchestration_model_reservations"."review_source_result_canonical_sha256" is null and "orchestration_model_reservations"."review_agent_id" is null and "orchestration_model_reservations"."review_run_id" is null and "orchestration_model_reservations"."review_execution_manifest_id" is null and "orchestration_model_reservations"."review_plan_version" is null
  ));
--> statement-breakpoint
ALTER TABLE "orchestration_model_reservations" ADD CONSTRAINT "orchestration_model_reservation_purpose_ck" CHECK ("orchestration_model_reservations"."purpose" in ('worker_model','review_model','conversation_model','read_only_verification','read_only_trajectory','provider_conformance','agent_safe_test','decision_shadow'));
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
  IF bound_plan IS NULL AND NEW.run_id IS NOT NULL AND NEW.tool_name = 'resolve_review' THEN
    SELECT r.plan_id INTO bound_plan
    FROM orchestration_model_reservations r
    JOIN issue_thread_interactions i ON i.company_id=r.company_id AND i.issue_id=r.review_issue_id AND i.id=r.review_interaction_id
    JOIN status_decisions d ON d.company_id=r.company_id AND d.issue_id=r.review_issue_id AND d.id=r.review_decision_id
    JOIN issues task ON task.company_id=r.company_id AND task.id=r.review_issue_id
    JOIN heartbeat_runs reviewer ON reviewer.company_id=r.company_id AND reviewer.agent_id=r.review_agent_id AND reviewer.id=r.review_run_id
    JOIN heartbeat_runs source ON source.company_id=r.company_id AND source.agent_id=r.review_source_agent_id AND source.id=r.review_source_run_id
    JOIN native_run_results result ON result.company_id=r.company_id AND result.issue_id=r.review_issue_id AND result.run_id=r.review_source_run_id AND result.id=r.review_source_result_id
    JOIN orchestration_worker_attempts attempt ON attempt.company_id=r.company_id AND attempt.plan_id=r.plan_id
      AND attempt.worker_id=r.review_source_worker_id AND attempt.id=r.review_source_attempt_id
    JOIN orchestration_workers source_worker ON source_worker.company_id=attempt.company_id AND source_worker.plan_id=attempt.plan_id
      AND source_worker.id=attempt.worker_id AND source_worker.issue_id=r.review_issue_id
    JOIN orchestration_plans p ON p.company_id=r.company_id AND p.id=r.plan_id
    WHERE r.company_id=NEW.company_id AND r.purpose='review_model' AND r.status='completed'
      AND r.review_run_id=NEW.run_id AND r.review_agent_id=NEW.agent_id AND r.review_issue_id=NEW.issue_id
      AND i.kind='request_confirmation' AND i.status='pending' AND i.addressee_agent_id=r.review_agent_id
      AND d.application_state='applied' AND task.status='in_review' AND task.last_status_decision_id=d.id
      AND source.status='succeeded' AND source.native_phase='committed' AND source.native_process_cleanup_pending=false
      AND result.canonical_sha256=r.review_source_result_canonical_sha256
      AND reviewer.status='running' AND reviewer.runtime_mode='native' AND reviewer.native_issue_id=r.review_issue_id
      AND reviewer.context_snapshot->>'nativeReviewInteractionId'=r.review_interaction_id::text
      AND reviewer.context_snapshot->>'nativeReviewDecisionId'=r.review_decision_id::text
      AND attempt.run_id=r.review_source_run_id AND attempt.agent_id=r.review_source_agent_id
      AND attempt.status IN ('running','succeeded') AND p.status='running' AND p.execution_principal->>'userId'=reviewer.responsible_user_id
      AND NEW.actor_type='agent' AND NEW.actor_id=r.review_agent_id::text
      AND NEW.idempotency_key LIKE 'aw-native-tool:'||r.review_run_id::text||':%'
    ORDER BY r.created_at DESC LIMIT 1;
  END IF;
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
  IF NEW.tool_name='resolve_review' AND NOT EXISTS(SELECT 1 FROM orchestration_model_reservations r WHERE r.company_id=NEW.company_id AND r.plan_id=plan_row.id AND r.review_run_id=NEW.run_id AND r.review_agent_id=NEW.agent_id AND r.review_issue_id=NEW.issue_id AND r.purpose='review_model' AND r.status='completed') THEN RAISE EXCEPTION 'orchestration_review_action_requires_current_reservation' USING ERRCODE='23514'; END IF;
  IF NEW.risk_level IN ('write','destructive') AND NEW.approval_state<>'approved' THEN RAISE EXCEPTION 'orchestration_material_tool_requires_approval' USING ERRCODE='23514'; END IF;
  IF EXISTS (SELECT 1 FROM orchestration_tool_charges WHERE invocation_id = NEW.id) THEN RETURN NEW; END IF;
  IF plan_row.tool_actions_used >= (plan_row.budgets->>'maxToolActions')::int THEN RAISE EXCEPTION 'orchestration_tool_budget_exhausted' USING ERRCODE = '23514'; END IF;
  INSERT INTO orchestration_tool_charges(invocation_id, company_id, plan_id) VALUES(NEW.id, NEW.company_id, plan_row.id) ON CONFLICT DO NOTHING RETURNING invocation_id INTO charged;
  IF charged IS NOT NULL THEN UPDATE orchestration_plans SET tool_actions_used = tool_actions_used + 1, updated_at = clock_timestamp() WHERE id = plan_row.id; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v7_review_model_reservation_binding_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND ROW(
    NEW.review_issue_id,NEW.review_interaction_id,NEW.review_decision_id,NEW.review_source_run_id,
    NEW.review_source_result_id,NEW.review_source_worker_id,NEW.review_source_agent_id,NEW.review_source_attempt_id,
    NEW.review_source_receipt_digest,NEW.review_source_result_canonical_sha256,NEW.review_agent_id,NEW.review_run_id,
    NEW.review_execution_manifest_id,NEW.review_plan_version
  ) IS DISTINCT FROM ROW(
    OLD.review_issue_id,OLD.review_interaction_id,OLD.review_decision_id,OLD.review_source_run_id,
    OLD.review_source_result_id,OLD.review_source_worker_id,OLD.review_source_agent_id,OLD.review_source_attempt_id,
    OLD.review_source_receipt_digest,OLD.review_source_result_canonical_sha256,OLD.review_agent_id,OLD.review_run_id,
    OLD.review_execution_manifest_id,OLD.review_plan_version
  ) THEN
    RAISE EXCEPTION 'review_model_reservation_binding_immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER aw_v7_review_model_reservation_binding_immutable
  BEFORE UPDATE ON orchestration_model_reservations
  FOR EACH ROW EXECUTE FUNCTION aw_v7_review_model_reservation_binding_immutable();
