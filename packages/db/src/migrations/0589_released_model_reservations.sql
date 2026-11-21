-- APR-E2E-22 (phase A). A model reservation that provably never reached the
-- provider no longer counts against its plan's model budget:
-- - `cancelled` (only reachable from `reserved`, so never dispatched);
-- - `failed` worker_model with no provider wire receipt, response hash or usage
--   (the transport records the wire receipt before it sends any byte), checked
--   at the transition against the worker attempt's Run: it must hold no wire
--   intent for the reservation (aw_v7_model_reservation_guard).
-- Every other status keeps its full maximum_minor, including completed
-- (settling completed calls to actual usage is phase B) and unknown.
--
-- The three functions below are copies of their latest definitions (guard and
-- charge from 0547, counter guard from 0382) with additions only. The charge
-- function also runs AFTER UPDATE OF status (new trigger), where a releasing
-- status change takes exactly that reservation's maximum_minor off its own
-- plan's counter. The counter guard keeps refusing any other decrease or
-- mismatch. The TypeScript mirror is
-- server/src/services/orchestration/model-reservation-release.ts.
CREATE OR REPLACE FUNCTION aw_v7_model_reservation_released(status text, purpose text, provider_wire_receipt jsonb,
  provider_response_hash text, usage jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT status='cancelled' OR (status='failed' AND purpose='worker_model' AND provider_wire_receipt IS NULL
    AND provider_response_hash IS NULL AND usage IS NULL);
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v7_model_reservation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p orchestration_plans; existing_total bigint; existing_calls bigint;
        r heartbeat_runs; i issues; m agent_execution_manifests; c companies; a agents;
        month_start timestamptz; company_spend bigint; agent_spend bigint;
BEGIN
 IF TG_OP='DELETE' THEN
   IF OLD.plan_id IS NULL THEN
     IF OLD.purpose='conversation_model' AND OLD.status NOT IN('dispatched','unknown') AND EXISTS(
       SELECT 1 FROM companies WHERE id=OLD.company_id AND status='archived' AND pause_reason='company_deleted'
         AND content_erasure_transaction_id=pg_current_xact_id()::text) THEN
       RETURN OLD;
     END IF;
     RAISE EXCEPTION 'model_reservation_debit_retained' USING ERRCODE='23514';
   END IF;
   IF EXISTS(SELECT 1 FROM orchestration_plans WHERE company_id=OLD.company_id AND id=OLD.plan_id) THEN
     RAISE EXCEPTION 'model_reservation_debit_retained' USING ERRCODE='23514';
   END IF;
   RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' THEN
   IF (NEW.company_id,NEW.plan_id,NEW.worker_id,NEW.worker_attempt_id,NEW.conversation_agent_id,NEW.conversation_run_id,
       NEW.conversation_issue_id,NEW.conversation_session_generation,NEW.execution_manifest_id,NEW.execution_manifest_hash,NEW.conversation_tariff_snapshot,NEW.purpose,NEW.principal_user_id,
       NEW.idempotency_key,NEW.request_hash,NEW.input_hash,NEW.authority_hash,NEW.quote,NEW.maximum_minor,NEW.expires_at,NEW.created_at)
     IS DISTINCT FROM
      (OLD.company_id,OLD.plan_id,OLD.worker_id,OLD.worker_attempt_id,OLD.conversation_agent_id,OLD.conversation_run_id,
       OLD.conversation_issue_id,OLD.conversation_session_generation,OLD.execution_manifest_id,OLD.execution_manifest_hash,OLD.conversation_tariff_snapshot,OLD.purpose,OLD.principal_user_id,
       OLD.idempotency_key,OLD.request_hash,OLD.input_hash,OLD.authority_hash,OLD.quote,OLD.maximum_minor,OLD.expires_at,OLD.created_at)
   THEN RAISE EXCEPTION 'model_reservation_inputs_immutable' USING ERRCODE='23514'; END IF;
   IF OLD.status=NEW.status THEN
     IF (NEW.dispatched_at,NEW.completed_at,NEW.provider_response_hash,NEW.usage) IS DISTINCT FROM
        (OLD.dispatched_at,OLD.completed_at,OLD.provider_response_hash,OLD.usage)
     THEN RAISE EXCEPTION 'model_reservation_receipt_immutable' USING ERRCODE='23514'; END IF;
     RETURN NEW;
   END IF;
   IF NOT ((OLD.status='reserved' AND NEW.status IN('dispatched','cancelled')) OR
           (OLD.status='dispatched' AND NEW.status IN('completed','failed','unknown')))
     OR (OLD.status='dispatched' AND NEW.dispatched_at IS DISTINCT FROM OLD.dispatched_at)
     OR (NEW.status='dispatched' AND (NEW.dispatched_at IS NULL OR NEW.completed_at IS NOT NULL OR
         NEW.provider_response_hash IS NOT NULL OR NEW.usage IS NOT NULL))
     OR (NEW.status IN('completed','failed','unknown','cancelled') AND NEW.completed_at IS NULL)
   THEN RAISE EXCEPTION 'model_reservation_transition_closed' USING ERRCODE='23514'; END IF;
   -- APR-E2E-22 (phase A). A worker_model call that ends failed with no provider
   -- wire receipt, response hash or usage counts zero (aw_v7_model_reservation_released).
   -- The transport records the wire receipt before it sends any byte; here the
   -- worker attempt's Run must also hold no wire intent for this reservation.
   IF NEW.status='failed' AND NEW.purpose='worker_model' AND NEW.provider_wire_receipt IS NULL
     AND NEW.provider_response_hash IS NULL AND NEW.usage IS NULL AND NOT EXISTS(
       SELECT 1 FROM orchestration_worker_attempts wa JOIN heartbeat_runs wr ON wr.company_id=wa.company_id AND wr.id=wa.run_id
       WHERE wa.company_id=NEW.company_id AND wa.plan_id=NEW.plan_id AND wa.id=NEW.worker_attempt_id AND wa.worker_id=NEW.worker_id
         AND NOT coalesce(wr.runner_profile_json->'nativeAwModelWireIntents' @> jsonb_build_array(jsonb_build_object('reservationId',NEW.id::text)),false))
   THEN RAISE EXCEPTION 'model_reservation_release_unproven' USING ERRCODE='23514'; END IF;
   IF NEW.status='dispatched' AND NEW.purpose='conversation_model' THEN
     SELECT * INTO r FROM heartbeat_runs WHERE company_id=NEW.company_id AND agent_id=NEW.conversation_agent_id
       AND id=NEW.conversation_run_id;
     SELECT * INTO i FROM issues WHERE company_id=NEW.company_id AND id=NEW.conversation_issue_id;
     SELECT * INTO m FROM agent_execution_manifests WHERE company_id=NEW.company_id AND id=NEW.execution_manifest_id
       AND agent_id=NEW.conversation_agent_id AND run_id=NEW.conversation_run_id;
     SELECT * INTO c FROM companies WHERE id=NEW.company_id FOR UPDATE;
     SELECT * INTO a FROM agents WHERE company_id=NEW.company_id AND id=NEW.conversation_agent_id FOR UPDATE;
     IF r.id IS NULL OR r.status IS DISTINCT FROM 'running' OR r.runtime_mode IS DISTINCT FROM 'native' OR r.native_issue_id IS DISTINCT FROM NEW.conversation_issue_id
       OR r.responsible_user_id IS DISTINCT FROM NEW.principal_user_id
       OR r.context_snapshot->>'conversationSessionGeneration' IS DISTINCT FROM NEW.conversation_session_generation::text
       OR r.native_input_source_protocol_version IS DISTINCT FROM 1
       OR jsonb_typeof(r.runner_profile_json->'nativeInputSourceReceipt') IS DISTINCT FROM 'object'
       OR i.id IS NULL OR i.conversation_agent_id IS DISTINCT FROM NEW.conversation_agent_id OR i.conversation_user_id IS DISTINCT FROM NEW.principal_user_id
       OR i.conversation_session_generation IS DISTINCT FROM NEW.conversation_session_generation OR i.conversation_state IS DISTINCT FROM 'active'
       OR i.conversation_retired_at IS NOT NULL OR i.execution_run_id IS DISTINCT FROM NEW.conversation_run_id OR i.status IS NULL OR i.status NOT IN('in_review','in_progress')
       OR i.payload_source_protocol_version IS DISTINCT FROM 1 OR i.payload_source_snapshot IS NULL OR i.payload_source_snapshot_invalidated IS DISTINCT FROM false
       OR i.payload_source_snapshot->'owner'->>'contentHash' IS DISTINCT FROM public.aw_native_payload_body_hash('issue',to_jsonb(i))
       OR i.payload_source_snapshot->>'digest' IS DISTINCT FROM encode(sha256(convert_to((i.payload_source_snapshot-'digest')::text,'UTF8')),'hex')
       OR m.id IS NULL OR m.hash IS DISTINCT FROM NEW.execution_manifest_hash OR m.manifest->>'responsibleUserId' IS DISTINCT FROM NEW.principal_user_id
       OR NEW.quote->>'provider' IS DISTINCT FROM NEW.conversation_tariff_snapshot->>'provider'
       OR NEW.quote->>'model' IS DISTINCT FROM NEW.conversation_tariff_snapshot->>'model'
       OR NEW.quote->>'sourceSha' IS DISTINCT FROM NEW.conversation_tariff_snapshot->>'sourceSha'
       OR NEW.quote->>'qualificationHash' IS DISTINCT FROM NEW.conversation_tariff_snapshot->>'qualificationHash'
       OR NEW.quote->>'tariffHash' IS DISTINCT FROM encode(sha256(convert_to(public.aw_native_canonical_jsonb(NEW.conversation_tariff_snapshot),'UTF8')),'hex')
       OR c.id IS NULL OR a.id IS NULL OR c.budget_monthly_cents<=0 OR a.budget_monthly_cents<=0
       OR NEW.expires_at<=clock_timestamp()
     THEN RAISE EXCEPTION 'conversation_model_dispatch_authority_closed' USING ERRCODE='23514'; END IF;
     month_start := date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
     SELECT coalesce(sum(cost_cents),0) INTO company_spend FROM cost_events
       WHERE company_id=NEW.company_id AND occurred_at>=month_start;
     SELECT coalesce(sum(cost_cents),0) INTO agent_spend FROM cost_events
       WHERE company_id=NEW.company_id AND agent_id=NEW.conversation_agent_id AND occurred_at>=month_start;
     SELECT coalesce(sum(maximum_minor),0),count(*) INTO existing_total,existing_calls
       FROM orchestration_model_reservations WHERE company_id=NEW.company_id AND conversation_run_id=NEW.conversation_run_id;
     IF company_spend+(SELECT coalesce(sum(maximum_minor),0) FROM orchestration_model_reservations
           WHERE company_id=NEW.company_id AND purpose='conversation_model' AND status IN('reserved','dispatched','unknown'))>c.budget_monthly_cents
       OR agent_spend+(SELECT coalesce(sum(maximum_minor),0) FROM orchestration_model_reservations
           WHERE company_id=NEW.company_id AND conversation_agent_id=NEW.conversation_agent_id AND purpose='conversation_model' AND status IN('reserved','dispatched','unknown'))>a.budget_monthly_cents
       OR existing_calls>64 THEN
       RAISE EXCEPTION 'conversation_model_budget_exhausted' USING ERRCODE='23514';
     END IF;
   ELSIF NEW.status='dispatched' THEN
     SELECT * INTO p FROM orchestration_plans WHERE company_id=NEW.company_id AND id=NEW.plan_id;
     IF p.id IS NULL OR p.erased_at IS NOT NULL OR p.status NOT IN('running','paused','verifying') OR NEW.expires_at<=clock_timestamp()
       OR (NEW.purpose='worker_model' AND p.status<>'running')
     THEN RAISE EXCEPTION 'model_dispatch_authority_closed' USING ERRCODE='23514'; END IF;
   END IF;
   RETURN NEW;
 END IF;

 IF NEW.purpose='conversation_model' THEN
   SELECT * INTO r FROM heartbeat_runs WHERE company_id=NEW.company_id AND agent_id=NEW.conversation_agent_id
     AND id=NEW.conversation_run_id FOR UPDATE;
   SELECT * INTO i FROM issues WHERE company_id=NEW.company_id AND id=NEW.conversation_issue_id FOR SHARE;
   SELECT * INTO m FROM agent_execution_manifests WHERE company_id=NEW.company_id AND id=NEW.execution_manifest_id
     AND agent_id=NEW.conversation_agent_id AND run_id=NEW.conversation_run_id FOR SHARE;
   SELECT * INTO c FROM companies WHERE id=NEW.company_id FOR UPDATE;
   SELECT * INTO a FROM agents WHERE company_id=NEW.company_id AND id=NEW.conversation_agent_id FOR UPDATE;
   IF r.id IS NULL OR r.status IS DISTINCT FROM 'running' OR r.runtime_mode IS DISTINCT FROM 'native' OR r.native_issue_id IS DISTINCT FROM NEW.conversation_issue_id
     OR r.responsible_user_id IS DISTINCT FROM NEW.principal_user_id
     OR r.context_snapshot->>'conversationSessionGeneration' IS DISTINCT FROM NEW.conversation_session_generation::text
     OR r.native_input_source_protocol_version IS DISTINCT FROM 1
     OR jsonb_typeof(r.runner_profile_json->'nativeInputSourceReceipt') IS DISTINCT FROM 'object'
     OR i.id IS NULL OR i.conversation_agent_id IS DISTINCT FROM NEW.conversation_agent_id OR i.conversation_user_id IS DISTINCT FROM NEW.principal_user_id
     OR i.conversation_session_generation IS DISTINCT FROM NEW.conversation_session_generation OR i.conversation_state IS DISTINCT FROM 'active'
     OR i.conversation_retired_at IS NOT NULL OR i.execution_run_id IS DISTINCT FROM NEW.conversation_run_id OR i.status IS NULL OR i.status NOT IN('in_review','in_progress')
     OR i.payload_source_protocol_version IS DISTINCT FROM 1 OR i.payload_source_snapshot IS NULL OR i.payload_source_snapshot_invalidated IS DISTINCT FROM false
     OR i.payload_source_snapshot->'owner'->>'contentHash' IS DISTINCT FROM public.aw_native_payload_body_hash('issue',to_jsonb(i))
     OR i.payload_source_snapshot->>'digest' IS DISTINCT FROM encode(sha256(convert_to((i.payload_source_snapshot-'digest')::text,'UTF8')),'hex')
     OR m.id IS NULL OR m.hash IS DISTINCT FROM NEW.execution_manifest_hash OR m.manifest->>'responsibleUserId' IS DISTINCT FROM NEW.principal_user_id
     OR NEW.quote->>'provider' IS DISTINCT FROM NEW.conversation_tariff_snapshot->>'provider'
     OR NEW.quote->>'model' IS DISTINCT FROM NEW.conversation_tariff_snapshot->>'model'
     OR NEW.quote->>'sourceSha' IS DISTINCT FROM NEW.conversation_tariff_snapshot->>'sourceSha'
     OR NEW.quote->>'qualificationHash' IS DISTINCT FROM NEW.conversation_tariff_snapshot->>'qualificationHash'
     OR NEW.quote->>'tariffHash' IS DISTINCT FROM encode(sha256(convert_to(public.aw_native_canonical_jsonb(NEW.conversation_tariff_snapshot),'UTF8')),'hex')
     OR c.id IS NULL OR a.id IS NULL OR c.budget_monthly_cents<=0 OR a.budget_monthly_cents<=0
     OR NEW.status<>'reserved' OR NEW.dispatched_at IS NOT NULL OR NEW.completed_at IS NOT NULL
     OR NEW.provider_response_hash IS NOT NULL OR NEW.usage IS NOT NULL
     OR NEW.expires_at<=clock_timestamp() OR NEW.expires_at>NEW.created_at+interval '5 minutes'
     OR NOT coalesce(jsonb_typeof(NEW.quote)='object' AND NEW.quote->>'version'='1' AND NEW.quote->>'currency'='USD'
       AND NEW.quote->>'provider' IN('openai','anthropic','openrouter') AND length(NEW.quote->>'model') BETWEEN 1 AND 200
       AND (NEW.quote->>'maximumMinor')::int=NEW.maximum_minor
       AND (NEW.quote->>'inputTokensUpperBound')::int BETWEEN 1 AND 2000000
       AND (NEW.quote->>'maxOutputTokens')::int BETWEEN 1 AND 65536
       AND NEW.quote->>'sourceSha' ~ '^[a-f0-9]{40}$' AND NEW.quote->>'tariffHash' ~ '^[a-f0-9]{64}$'
       AND NEW.quote->>'qualificationHash' ~ '^[a-f0-9]{64}$'
       AND (NEW.quote->>'expiresAt')::timestamptz>=NEW.expires_at,false)
   THEN RAISE EXCEPTION 'conversation_model_reservation_scope_closed' USING ERRCODE='23514'; END IF;
   month_start := date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
   SELECT coalesce(sum(cost_cents),0) INTO company_spend FROM cost_events
     WHERE company_id=NEW.company_id AND occurred_at>=month_start;
   SELECT coalesce(sum(cost_cents),0) INTO agent_spend FROM cost_events
     WHERE company_id=NEW.company_id AND agent_id=NEW.conversation_agent_id AND occurred_at>=month_start;
   SELECT count(*) INTO existing_calls FROM orchestration_model_reservations
     WHERE company_id=NEW.company_id AND conversation_run_id=NEW.conversation_run_id;
   IF existing_calls>=64
     OR company_spend+(SELECT coalesce(sum(maximum_minor),0) FROM orchestration_model_reservations
          WHERE company_id=NEW.company_id AND purpose='conversation_model' AND status IN('reserved','dispatched','unknown'))+NEW.maximum_minor>c.budget_monthly_cents
     OR agent_spend+(SELECT coalesce(sum(maximum_minor),0) FROM orchestration_model_reservations
          WHERE company_id=NEW.company_id AND conversation_agent_id=NEW.conversation_agent_id AND purpose='conversation_model' AND status IN('reserved','dispatched','unknown'))+NEW.maximum_minor>a.budget_monthly_cents
   THEN RAISE EXCEPTION 'conversation_model_budget_exhausted' USING ERRCODE='23514'; END IF;
   RETURN NEW;
 END IF;

 SELECT * INTO p FROM orchestration_plans WHERE company_id=NEW.company_id AND id=NEW.plan_id FOR UPDATE;
 IF p.id IS NULL OR p.erased_at IS NOT NULL OR p.status IN('completed','cancelled','failed') OR p.risk_class='C4'
   OR (NEW.purpose='worker_model' AND p.budgets->'maxModelCostMinor'='null'::jsonb)
   OR NEW.status<>'reserved' OR NEW.dispatched_at IS NOT NULL OR NEW.completed_at IS NOT NULL
   OR NEW.provider_response_hash IS NOT NULL OR NEW.usage IS NOT NULL
   OR NEW.expires_at<=clock_timestamp() OR NEW.expires_at>NEW.created_at+interval '5 minutes'
   OR NOT coalesce(jsonb_typeof(NEW.quote)='object' AND NEW.quote->>'version'='1' AND NEW.quote->>'currency'='USD'
     AND NEW.quote->>'provider' IN('openai','anthropic','openrouter') AND length(NEW.quote->>'model') BETWEEN 1 AND 200
     AND (NEW.quote->>'maximumMinor')::int=NEW.maximum_minor
     AND (NEW.quote->>'inputTokensUpperBound')::int BETWEEN 1 AND 2000000
     AND (NEW.quote->>'maxOutputTokens')::int BETWEEN 1 AND 65536
     AND NEW.quote->>'sourceSha' ~ '^[a-f0-9]{40}$' AND NEW.quote->>'tariffHash' ~ '^[a-f0-9]{64}$'
     AND NEW.quote->>'qualificationHash' ~ '^[a-f0-9]{64}$'
     AND (NEW.quote->>'expiresAt')::timestamptz>=NEW.expires_at,false)
 THEN RAISE EXCEPTION 'model_reservation_scope_closed' USING ERRCODE='23514'; END IF;
 IF NEW.purpose IN ('read_only_verification','read_only_trajectory') AND
   (p.verifier_calls_used >= (p.supervision_policy->>'maxVerifierCalls')::int OR
    (p.supervision_policy->>'maxVerificationDepth')::int<1)
 THEN RAISE EXCEPTION 'model_verifier_call_budget_exhausted' USING ERRCODE='23514'; END IF;
 IF NEW.worker_attempt_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM orchestration_worker_attempts
   WHERE company_id=NEW.company_id AND plan_id=NEW.plan_id AND id=NEW.worker_attempt_id AND worker_id=NEW.worker_id)
 THEN RAISE EXCEPTION 'model_reservation_attempt_scope' USING ERRCODE='23514'; END IF;
 SELECT coalesce(sum(maximum_minor),0) INTO existing_total FROM orchestration_model_reservations
   WHERE company_id=NEW.company_id AND plan_id=NEW.plan_id
     AND NOT aw_v7_model_reservation_released(status,purpose,provider_wire_receipt,provider_response_hash,usage);
 IF existing_total<>p.model_cost_reserved OR (p.budgets->'maxModelCostMinor'<>'null'::jsonb AND
   existing_total+NEW.maximum_minor>(p.budgets->>'maxModelCostMinor')::int)
 THEN RAISE EXCEPTION 'model_reservation_budget_exhausted' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v7_model_reservation_charge() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 -- APR-E2E-22 (phase A). A reservation's status change that releases it (it
 -- provably never reached the provider) takes exactly its maximum_minor off its
 -- own plan's counter; the counter guard re-checks the ledger.
 IF TG_OP='UPDATE' THEN
   IF NEW.plan_id IS NOT NULL AND OLD.status IS DISTINCT FROM NEW.status
     AND NOT aw_v7_model_reservation_released(OLD.status,OLD.purpose,OLD.provider_wire_receipt,OLD.provider_response_hash,OLD.usage)
     AND aw_v7_model_reservation_released(NEW.status,NEW.purpose,NEW.provider_wire_receipt,NEW.provider_response_hash,NEW.usage) THEN
     UPDATE orchestration_plans SET model_cost_reserved=model_cost_reserved-NEW.maximum_minor,
       updated_at=clock_timestamp() WHERE company_id=NEW.company_id AND id=NEW.plan_id;
   END IF;
   RETURN NEW;
 END IF;
 IF NEW.plan_id IS NOT NULL THEN
   UPDATE orchestration_plans SET model_cost_reserved=model_cost_reserved+NEW.maximum_minor,
     verifier_calls_used=verifier_calls_used+CASE WHEN NEW.purpose IN ('read_only_verification','read_only_trajectory') THEN 1 ELSE 0 END,
     updated_at=clock_timestamp() WHERE company_id=NEW.company_id AND id=NEW.plan_id;
 END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v7_model_budget_counter_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ledger_total bigint; ledger_calls bigint;
BEGIN
 IF NEW.model_cost_reserved=OLD.model_cost_reserved AND NEW.verifier_calls_used=OLD.verifier_calls_used THEN RETURN NEW; END IF;
 SELECT coalesce(sum(maximum_minor),0),count(*) FILTER(WHERE purpose IN ('read_only_verification','read_only_trajectory')) INTO ledger_total,ledger_calls FROM orchestration_model_reservations WHERE company_id=NEW.company_id AND plan_id=NEW.id;
 -- APR-E2E-22 (phase A). Released reservations count zero. The counter may fall
 -- only to the ledger without them, which drops only through a reservation's
 -- releasing status change on this plan (reservations are immutable otherwise).
 SELECT coalesce(sum(maximum_minor),0) INTO ledger_total FROM orchestration_model_reservations
   WHERE company_id=NEW.company_id AND plan_id=NEW.id
     AND NOT aw_v7_model_reservation_released(status,purpose,provider_wire_receipt,provider_response_hash,usage);
 IF NEW.model_cost_reserved<>ledger_total OR NEW.verifier_calls_used<>ledger_calls OR (NEW.model_cost_reserved<OLD.model_cost_reserved
   AND NOT EXISTS(SELECT 1 FROM orchestration_model_reservations rr WHERE rr.company_id=NEW.company_id AND rr.plan_id=NEW.id
     AND rr.maximum_minor=OLD.model_cost_reserved-NEW.model_cost_reserved
     AND aw_v7_model_reservation_released(rr.status,rr.purpose,rr.provider_wire_receipt,rr.provider_response_hash,rr.usage))) OR NEW.verifier_calls_used<OLD.verifier_calls_used
   OR (NEW.budgets->'maxModelCostMinor'<>'null'::jsonb AND NEW.model_cost_reserved>(NEW.budgets->>'maxModelCostMinor')::int)
 THEN RAISE EXCEPTION 'model_budget_counter_requires_native_reservations' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
-- Backfill: existing released reservations (cancelled rows, chiefly from the
-- expiry sweep) stop counting. Only this one statement runs with the counter
-- guard disabled, and it sets each plan's counter to exactly the ledger the
-- guard checks from here on.
ALTER TABLE orchestration_plans DISABLE TRIGGER aw_v7_model_budget_counter_guard;
--> statement-breakpoint
UPDATE orchestration_plans p SET model_cost_reserved=l.total
  FROM (SELECT pl.company_id, pl.id, coalesce(sum(r.maximum_minor) FILTER (WHERE NOT aw_v7_model_reservation_released(
      r.status,r.purpose,r.provider_wire_receipt,r.provider_response_hash,r.usage)),0) AS total
    FROM orchestration_plans pl LEFT JOIN orchestration_model_reservations r ON r.company_id=pl.company_id AND r.plan_id=pl.id
    GROUP BY pl.company_id, pl.id) l
  WHERE p.company_id=l.company_id AND p.id=l.id AND p.model_cost_reserved<>l.total;
--> statement-breakpoint
ALTER TABLE orchestration_plans ENABLE TRIGGER aw_v7_model_budget_counter_guard;
--> statement-breakpoint
CREATE TRIGGER aw_v7_model_reservation_release AFTER UPDATE OF status ON orchestration_model_reservations FOR EACH ROW EXECUTE FUNCTION aw_v7_model_reservation_charge();
