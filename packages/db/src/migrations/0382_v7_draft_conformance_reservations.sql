ALTER TABLE "orchestration_model_reservations" DROP CONSTRAINT "orchestration_model_reservation_purpose_ck";--> statement-breakpoint
ALTER TABLE "orchestration_model_reservations" ADD CONSTRAINT "orchestration_model_reservation_purpose_ck" CHECK ("orchestration_model_reservations"."purpose" in ('worker_model','read_only_verification','read_only_trajectory','provider_conformance'));
--> statement-breakpoint
-- Qualification uses the existing financial ledger with a private, paused
-- harness. It cannot confer worker/tool authority or debit a customer Task.
CREATE OR REPLACE FUNCTION aw_v7_conformance_reservation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p orchestration_plans; t issues;
BEGIN
 IF NEW.purpose<>'provider_conformance' OR (TG_OP='UPDATE' AND NEW.status<>'dispatched') THEN RETURN NEW; END IF;
 SELECT * INTO p FROM orchestration_plans WHERE company_id=NEW.company_id AND id=NEW.plan_id FOR UPDATE;
 SELECT * INTO t FROM issues WHERE company_id=NEW.company_id AND id=p.issue_id FOR SHARE;
 IF p.id IS NULL OR t.id IS NULL OR t.hidden_at IS NULL OR t.harness_kind IS DISTINCT FROM 'provider_conformance'
   OR p.status<>'paused' OR p.erased_at IS NOT NULL OR p.started_at IS NULL
   OR p.action_class<>'internal_draft' OR p.risk_class<>'C0'
   OR (p.budgets->>'maxToolActions')::int<>0 OR p.tool_actions_used<>0 OR p.budgets->'maxModelCostMinor'='null'::jsonb
   OR p.execution_principal->>'type' IS DISTINCT FROM 'user'
   OR p.execution_principal->>'userId' IS DISTINCT FROM NEW.principal_user_id
   OR p.created_by<>NEW.principal_user_id
   OR p.started_at+make_interval(secs=>(p.budgets->>'maxWallClockSeconds')::int)<=clock_timestamp()
   OR NEW.worker_id IS NOT NULL OR NEW.worker_attempt_id IS NOT NULL
   OR EXISTS(SELECT 1 FROM orchestration_workers WHERE company_id=NEW.company_id AND plan_id=NEW.plan_id)
 THEN RAISE EXCEPTION 'provider_conformance_harness_closed' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER aw_v7_conformance_reservation_guard BEFORE INSERT OR UPDATE ON orchestration_model_reservations FOR EACH ROW EXECUTE FUNCTION aw_v7_conformance_reservation_guard();

--> statement-breakpoint
-- Only actual read-only assessments consume the verifier call counter.
CREATE OR REPLACE FUNCTION aw_v7_model_reservation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p orchestration_plans; existing_total bigint;
BEGIN
 IF TG_OP='DELETE' THEN
   IF EXISTS(SELECT 1 FROM orchestration_plans WHERE company_id=OLD.company_id AND id=OLD.plan_id) THEN
     RAISE EXCEPTION 'model_reservation_debit_retained' USING ERRCODE='23514';
   END IF;
   RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' THEN
   IF (NEW.company_id,NEW.plan_id,NEW.worker_id,NEW.worker_attempt_id,NEW.purpose,NEW.principal_user_id,NEW.idempotency_key,NEW.request_hash,NEW.input_hash,NEW.authority_hash,NEW.quote,NEW.maximum_minor,NEW.expires_at,NEW.created_at)
     IS DISTINCT FROM (OLD.company_id,OLD.plan_id,OLD.worker_id,OLD.worker_attempt_id,OLD.purpose,OLD.principal_user_id,OLD.idempotency_key,OLD.request_hash,OLD.input_hash,OLD.authority_hash,OLD.quote,OLD.maximum_minor,OLD.expires_at,OLD.created_at)
   THEN RAISE EXCEPTION 'model_reservation_inputs_immutable' USING ERRCODE='23514'; END IF;
   IF OLD.status=NEW.status THEN
     IF (NEW.dispatched_at,NEW.completed_at,NEW.provider_response_hash,NEW.usage) IS DISTINCT FROM (OLD.dispatched_at,OLD.completed_at,OLD.provider_response_hash,OLD.usage)
     THEN RAISE EXCEPTION 'model_reservation_receipt_immutable' USING ERRCODE='23514'; END IF;
     RETURN NEW;
   END IF;
   IF NOT ((OLD.status='reserved' AND NEW.status IN('dispatched','cancelled')) OR (OLD.status='dispatched' AND NEW.status IN('completed','failed','unknown')))
     OR (OLD.status='dispatched' AND NEW.dispatched_at IS DISTINCT FROM OLD.dispatched_at)
     OR (NEW.status='dispatched' AND (NEW.dispatched_at IS NULL OR NEW.completed_at IS NOT NULL OR NEW.provider_response_hash IS NOT NULL OR NEW.usage IS NOT NULL))
     OR (NEW.status IN('completed','failed','unknown','cancelled') AND NEW.completed_at IS NULL)
   THEN RAISE EXCEPTION 'model_reservation_transition_closed' USING ERRCODE='23514'; END IF;
   IF NEW.status='dispatched' THEN
     SELECT * INTO p FROM orchestration_plans WHERE company_id=NEW.company_id AND id=NEW.plan_id;
     IF p.id IS NULL OR p.erased_at IS NOT NULL OR p.status NOT IN('running','paused','verifying') OR NEW.expires_at<=clock_timestamp()
       OR (NEW.purpose='worker_model' AND p.status<>'running')
     THEN RAISE EXCEPTION 'model_dispatch_authority_closed' USING ERRCODE='23514'; END IF;
   END IF;
   RETURN NEW;
 END IF;
 SELECT * INTO p FROM orchestration_plans WHERE company_id=NEW.company_id AND id=NEW.plan_id FOR UPDATE;
 IF p.id IS NULL OR p.erased_at IS NOT NULL OR p.status IN('completed','cancelled','failed') OR p.risk_class='C4' OR (NEW.purpose='worker_model' AND p.budgets->'maxModelCostMinor'='null'::jsonb)
   OR NEW.status<>'reserved' OR NEW.dispatched_at IS NOT NULL OR NEW.completed_at IS NOT NULL OR NEW.provider_response_hash IS NOT NULL OR NEW.usage IS NOT NULL
   OR NEW.expires_at<=clock_timestamp() OR NEW.expires_at>NEW.created_at+interval '5 minutes'
   OR NOT coalesce(jsonb_typeof(NEW.quote)='object' AND NEW.quote->>'version'='1' AND NEW.quote->>'currency'='USD'
     AND NEW.quote->>'provider' IN('openai','anthropic','openrouter') AND length(NEW.quote->>'model') BETWEEN 1 AND 200
     AND (NEW.quote->>'maximumMinor')::int=NEW.maximum_minor
     AND (NEW.quote->>'inputTokensUpperBound')::int BETWEEN 1 AND 2000000
     AND (NEW.quote->>'maxOutputTokens')::int BETWEEN 1 AND 65536
     AND NEW.quote->>'sourceSha' ~ '^[a-f0-9]{40}$' AND NEW.quote->>'tariffHash' ~ '^[a-f0-9]{64}$' AND NEW.quote->>'qualificationHash' ~ '^[a-f0-9]{64}$'
     AND (NEW.quote->>'expiresAt')::timestamptz>=NEW.expires_at,false)
 THEN RAISE EXCEPTION 'model_reservation_scope_closed' USING ERRCODE='23514'; END IF;
 IF NEW.purpose IN ('read_only_verification','read_only_trajectory') AND (p.verifier_calls_used >= (p.supervision_policy->>'maxVerifierCalls')::int OR (p.supervision_policy->>'maxVerificationDepth')::int<1) THEN RAISE EXCEPTION 'model_verifier_call_budget_exhausted' USING ERRCODE='23514'; END IF;
 IF NEW.worker_attempt_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM orchestration_worker_attempts WHERE company_id=NEW.company_id AND plan_id=NEW.plan_id AND id=NEW.worker_attempt_id AND worker_id=NEW.worker_id)
 THEN RAISE EXCEPTION 'model_reservation_attempt_scope' USING ERRCODE='23514'; END IF;
 SELECT coalesce(sum(maximum_minor),0) INTO existing_total FROM orchestration_model_reservations WHERE company_id=NEW.company_id AND plan_id=NEW.plan_id;
 IF existing_total<>p.model_cost_reserved OR (p.budgets->'maxModelCostMinor'<>'null'::jsonb AND existing_total+NEW.maximum_minor>(p.budgets->>'maxModelCostMinor')::int)
 THEN RAISE EXCEPTION 'model_reservation_budget_exhausted' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v7_model_reservation_charge() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE orchestration_plans SET model_cost_reserved=model_cost_reserved+NEW.maximum_minor,
   verifier_calls_used=verifier_calls_used+CASE WHEN NEW.purpose IN ('read_only_verification','read_only_trajectory') THEN 1 ELSE 0 END,
   updated_at=clock_timestamp() WHERE company_id=NEW.company_id AND id=NEW.plan_id;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v7_model_budget_counter_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ledger_total bigint; ledger_calls bigint;
BEGIN
 IF NEW.model_cost_reserved=OLD.model_cost_reserved AND NEW.verifier_calls_used=OLD.verifier_calls_used THEN RETURN NEW; END IF;
 SELECT coalesce(sum(maximum_minor),0),count(*) FILTER(WHERE purpose IN ('read_only_verification','read_only_trajectory')) INTO ledger_total,ledger_calls FROM orchestration_model_reservations WHERE company_id=NEW.company_id AND plan_id=NEW.id;
 IF NEW.model_cost_reserved<>ledger_total OR NEW.verifier_calls_used<>ledger_calls OR NEW.model_cost_reserved<OLD.model_cost_reserved OR NEW.verifier_calls_used<OLD.verifier_calls_used
   OR (NEW.budgets->'maxModelCostMinor'<>'null'::jsonb AND NEW.model_cost_reserved>(NEW.budgets->>'maxModelCostMinor')::int)
 THEN RAISE EXCEPTION 'model_budget_counter_requires_native_reservations' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
