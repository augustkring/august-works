ALTER TABLE "verification_runs" DROP CONSTRAINT "verification_reviewer_check";--> statement-breakpoint
ALTER TABLE "verification_runs" ADD COLUMN "model_reservation_id" uuid;--> statement-breakpoint
ALTER TABLE "verification_runs" ADD CONSTRAINT "verification_runs_company_id_model_reservation_id_orchestration_model_reservations_company_id_id_fk" FOREIGN KEY ("company_id","model_reservation_id") REFERENCES "public"."orchestration_model_reservations"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_runs" ADD CONSTRAINT "verification_model_reservation_uq" UNIQUE("model_reservation_id");--> statement-breakpoint
ALTER TABLE "verification_runs" ADD CONSTRAINT "verification_reviewer_check" CHECK (("verification_runs"."reviewer_type"='human' and "verification_runs"."model_reservation_id" is null) or ("verification_runs"."reviewer_type"='model' and "verification_runs"."model_reservation_id" is not null and "verification_runs"."result"<>'pass'));
--> statement-breakpoint
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
 IF NEW.purpose<>'worker_model' AND (p.verifier_calls_used >= (p.supervision_policy->>'maxVerifierCalls')::int OR (p.supervision_policy->>'maxVerificationDepth')::int<1) THEN RAISE EXCEPTION 'model_verifier_call_budget_exhausted' USING ERRCODE='23514'; END IF;
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
   verifier_calls_used=verifier_calls_used+CASE WHEN NEW.purpose='worker_model' THEN 0 ELSE 1 END,
   updated_at=clock_timestamp() WHERE company_id=NEW.company_id AND id=NEW.plan_id;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v7_model_budget_counter_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ledger_total bigint; ledger_calls bigint;
BEGIN
 IF NEW.model_cost_reserved=OLD.model_cost_reserved AND NEW.verifier_calls_used=OLD.verifier_calls_used THEN RETURN NEW; END IF;
 SELECT coalesce(sum(maximum_minor),0),count(*) FILTER(WHERE purpose<>'worker_model') INTO ledger_total,ledger_calls FROM orchestration_model_reservations WHERE company_id=NEW.company_id AND plan_id=NEW.id;
 IF NEW.model_cost_reserved<>ledger_total OR NEW.verifier_calls_used<>ledger_calls OR NEW.model_cost_reserved<OLD.model_cost_reserved OR NEW.verifier_calls_used<OLD.verifier_calls_used
   OR (NEW.budgets->'maxModelCostMinor'<>'null'::jsonb AND NEW.model_cost_reserved>(NEW.budgets->>'maxModelCostMinor')::int)
 THEN RAISE EXCEPTION 'model_budget_counter_requires_native_reservations' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
DROP TRIGGER aw_v7_model_budget_counter_guard ON orchestration_plans;
--> statement-breakpoint
CREATE TRIGGER aw_v7_model_budget_counter_guard BEFORE UPDATE OF model_cost_reserved,verifier_calls_used ON orchestration_plans FOR EACH ROW EXECUTE FUNCTION aw_v7_model_budget_counter_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v7_model_assessment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r orchestration_model_reservations; p orchestration_plans;
BEGIN
 IF TG_OP='UPDATE' AND NEW.model_reservation_id IS DISTINCT FROM OLD.model_reservation_id THEN
  RAISE EXCEPTION 'model_review_spend_pin_immutable' USING ERRCODE='23514';
 END IF;
 IF TG_OP='INSERT' AND NEW.reviewer_type='model' THEN
  SELECT * INTO r FROM orchestration_model_reservations WHERE company_id=NEW.company_id AND id=NEW.model_reservation_id;
  SELECT * INTO p FROM orchestration_plans WHERE company_id=NEW.company_id AND id=NEW.plan_id;
  IF r.id IS NULL OR r.plan_id<>NEW.plan_id OR r.status<>'completed' OR r.purpose<>'read_only_verification' OR r.worker_id IS DISTINCT FROM NEW.worker_id
    OR r.provider_response_hash IS NULL OR r.usage IS NULL OR r.expires_at<=clock_timestamp()
    OR p.id IS NULL OR p.erased_at IS NOT NULL OR p.version<>NEW.expected_plan_version OR p.status NOT IN('running','paused','verifying') OR NEW.result='pass'
    OR p.risk_class='C4' OR NOT coalesce(p.execution_principal->>'type'='user' AND p.execution_principal->>'userId'=r.principal_user_id,false)
    OR p.started_at IS NULL OR p.started_at+((p.budgets->>'maxWallClockSeconds')::int*interval '1 second')<=clock_timestamp()
    OR NEW.review IS NOT NULL OR NEW.recommendation<>'ESCALATE_HUMAN'
  THEN RAISE EXCEPTION 'model_review_requires_native_single_use_dispatch' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER aw_v7_model_assessment_guard BEFORE INSERT OR UPDATE ON verification_runs FOR EACH ROW EXECUTE FUNCTION aw_v7_model_assessment_guard();
