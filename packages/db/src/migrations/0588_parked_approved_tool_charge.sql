-- APR-E2E-17 (option A). Approving a parked tool call after the requesting
-- Run ended was always refused by the tool-charge guard with
-- orchestration_attempt_stopped, because the guard requires the invocation's
-- Run and attempt to be running. The tool gateway executes an approved parked
-- call on the server at approval time, after that Run has parked and ended.
--
-- This is a copy of the 0585 definition of aw_v7_orchestration_tool_charge
-- with additions only: the attempt-stopped refusal is skipped for exactly one
-- case, a server-executed, Human-approved parked invocation on its original
-- plan (see the comment in the function). Everything after it is unchanged:
-- the plan must be running, inside its wall-clock budget and feature gates,
-- write and destructive tools still need approval_state approved, the tool
-- action budget hard stop still applies, and the charge is recorded once per
-- invocation. The TypeScript mirror is
-- server/src/services/orchestration/parked-approved-tool-charge.ts.
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
  -- MS1f decision 6 (MS1h12b). The current completion Reviewer's read of one
  -- declared required-output document of the reviewed Task (arguments exactly
  -- {"key":<declared task_document key>}), bound like resolve_review.
  IF bound_plan IS NULL AND NEW.run_id IS NOT NULL AND NEW.tool_name = 'read_document' THEN
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
    JOIN completion_contracts contract ON contract.company_id=source_worker.company_id AND contract.issue_id=source_worker.issue_id
      AND contract.id=source_worker.completion_contract_id
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
      AND r.review_stage_id IS NULL AND EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(contract.contract_json->'v7'->'requiredOutputs')='array'
        THEN contract.contract_json->'v7'->'requiredOutputs' ELSE '[]'::jsonb END) output
        WHERE coalesce(output->>'kind','task_document')='task_document' AND output->>'key' ~ '^[a-z][a-z0-9_-]{0,79}$'
          AND NEW.arguments_hash=encode(sha256(convert_to('{"key":"'||(output->>'key')||'"}','UTF8')),'hex'))
    ORDER BY r.created_at DESC LIMIT 1;
  END IF;
  -- MS1f decision 4. The current execution-policy stage Reviewer (a stage-bound
  -- review_model reservation, no plan worker attempt): its stage-comment
  -- call_api, and (decision 6) its read of one declared required-output
  -- document. The Task is in review with this exact pending review stage, this
  -- Reviewer as participant, assignee and execution Run, and the source plan
  -- Worker (not this Reviewer) as return assignee.
  IF bound_plan IS NULL AND NEW.run_id IS NOT NULL AND NEW.tool_name IN ('call_api','read_document') THEN
    SELECT r.plan_id INTO bound_plan
    FROM orchestration_model_reservations r
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
    JOIN completion_contracts contract ON contract.company_id=source_worker.company_id AND contract.issue_id=source_worker.issue_id
      AND contract.id=source_worker.completion_contract_id
    WHERE r.company_id=NEW.company_id AND r.purpose='review_model' AND r.status='completed'
      AND r.review_interaction_id IS NULL AND r.review_stage_id IS NOT NULL
      AND r.review_run_id=NEW.run_id AND r.review_agent_id=NEW.agent_id AND r.review_issue_id=NEW.issue_id
      AND r.review_source_agent_id<>r.review_agent_id
      AND d.application_state='applied' AND d.reason_code='execution_policy_stage_pending' AND d.to_status='in_review'
      AND d.run_id=r.review_source_run_id
      AND task.status='in_review' AND task.last_status_decision_id=d.id AND task.assignee_agent_id=r.review_agent_id
      AND task.execution_run_id=r.review_run_id
      AND task.execution_state->>'status'='pending' AND task.execution_state->>'currentStageType'='review'
      AND task.execution_state->>'currentStageId'=r.review_stage_id
      AND task.execution_state->'currentParticipant'->>'type'='agent'
      AND task.execution_state->'currentParticipant'->>'agentId'=r.review_agent_id::text
      AND task.execution_state->'returnAssignee'->>'type'='agent'
      AND task.execution_state->'returnAssignee'->>'agentId'=r.review_source_agent_id::text
      AND source.status='succeeded' AND source.native_phase='committed' AND source.native_process_cleanup_pending=false
      AND result.canonical_sha256=r.review_source_result_canonical_sha256
      AND reviewer.status='running' AND reviewer.runtime_mode='native' AND reviewer.native_issue_id=r.review_issue_id
      AND reviewer.context_snapshot->>'source'='issue.execution_stage'
      AND reviewer.context_snapshot->'executionStage'->>'wakeRole'='reviewer'
      AND reviewer.context_snapshot->'executionStage'->>'stageId'=r.review_stage_id
      AND reviewer.context_snapshot ? 'nativeStatusWakeIntentId'
      AND NOT (reviewer.context_snapshot ? 'nativeReviewInteractionId')
      AND attempt.run_id=r.review_source_run_id AND attempt.agent_id=r.review_source_agent_id
      AND attempt.status IN ('running','succeeded') AND p.status='running' AND p.execution_principal->>'userId'=reviewer.responsible_user_id
      AND NEW.actor_type='agent' AND NEW.actor_id=r.review_agent_id::text
      AND NEW.idempotency_key LIKE 'aw-native-tool:'||r.review_run_id::text||':%'
      AND (NEW.tool_name='call_api' OR EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(contract.contract_json->'v7'->'requiredOutputs')='array'
        THEN contract.contract_json->'v7'->'requiredOutputs' ELSE '[]'::jsonb END) output
        WHERE coalesce(output->>'kind','task_document')='task_document' AND output->>'key' ~ '^[a-z][a-z0-9_-]{0,79}$'
          AND NEW.arguments_hash=encode(sha256(convert_to('{"key":"'||(output->>'key')||'"}','UTF8')),'hex')))
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
      -- APR-E2E-17. A server-executed, Human-approved parked call: the parked
      -- invocation moves awaiting_approval -> executing once, its one action
      -- request was decided by a Human (never an Agent) before this transition
      -- and is claimed, and its own Run's attempt on this same plan and Task
      -- ended normally. It is charged to that original plan below, under the
      -- same plan, wall-clock, budget and once-per-invocation checks.
      AND NOT (TG_OP = 'UPDATE' AND OLD.status = 'awaiting_approval' AND NEW.approval_state = 'approved'
        AND NEW.issue_id IS NOT NULL AND NEW.agent_id IS NOT NULL
        AND (SELECT count(*) FROM tool_action_requests q WHERE q.company_id=NEW.company_id AND q.invocation_id=NEW.id) = 1
        AND EXISTS(SELECT 1 FROM tool_action_requests q WHERE q.company_id=NEW.company_id AND q.invocation_id=NEW.id
          AND q.status='executing' AND q.decided_by_user_id IS NOT NULL AND q.decided_by_agent_id IS NULL
          AND q.decided_at IS NOT NULL AND q.decided_at <= clock_timestamp())
        AND EXISTS(SELECT 1 FROM orchestration_worker_attempts a JOIN heartbeat_runs r ON r.company_id=a.company_id AND r.id=a.run_id JOIN orchestration_workers w ON w.company_id=a.company_id AND w.id=a.worker_id JOIN issues t ON t.company_id=w.company_id AND t.id=w.issue_id
          WHERE a.company_id=NEW.company_id AND a.run_id=NEW.run_id AND a.plan_id=plan_row.id AND a.status IN ('running','succeeded') AND r.status IN ('running','succeeded')
            AND w.issue_id=NEW.issue_id AND w.agent_id=NEW.agent_id AND r.agent_id=NEW.agent_id AND t.status NOT IN ('done','cancelled') AND t.assignee_agent_id=w.agent_id
            AND coalesce(r.result_json->'executionCancellation'->>'state','') <> 'requested'))
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
