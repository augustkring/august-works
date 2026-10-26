-- Preserve the single financial reservation ledger while admitting authenticated
-- Native conversations without fabricating an orchestration plan or worker.
ALTER TABLE orchestration_model_reservations ALTER COLUMN plan_id DROP NOT NULL;
ALTER TABLE orchestration_model_reservations
  ADD COLUMN conversation_agent_id uuid,
  ADD COLUMN conversation_run_id uuid,
  ADD COLUMN conversation_issue_id uuid,
  ADD COLUMN conversation_session_generation integer,
  ADD COLUMN execution_manifest_id uuid,
  ADD COLUMN execution_manifest_hash text,
  ADD COLUMN conversation_tariff_snapshot jsonb;
ALTER TABLE orchestration_model_reservations
  DROP CONSTRAINT orchestration_model_reservation_purpose_ck,
  ADD CONSTRAINT orchestration_model_reservation_purpose_ck CHECK (purpose in
    ('worker_model','conversation_model','read_only_verification','read_only_trajectory','provider_conformance','agent_safe_test','decision_shadow')),
  ADD CONSTRAINT orchestration_model_reservation_scope_ck CHECK (
    (purpose='conversation_model' and plan_id is null and worker_id is null and worker_attempt_id is null
      and conversation_agent_id is not null and conversation_run_id is not null and conversation_issue_id is not null
      and conversation_session_generation is not null and conversation_session_generation>=0 and execution_manifest_id is not null
      and execution_manifest_hash is not null and execution_manifest_hash ~ '^[a-f0-9]{64}$'
      and conversation_tariff_snapshot is not null and jsonb_typeof(conversation_tariff_snapshot)='object')
    or (purpose<>'conversation_model' and plan_id is not null and conversation_agent_id is null and conversation_run_id is null
      and conversation_issue_id is null and conversation_session_generation is null and execution_manifest_id is null and execution_manifest_hash is null
      and conversation_tariff_snapshot is null)
  );
ALTER TABLE orchestration_model_reservations
  ADD CONSTRAINT orchestration_model_reservations_conversation_run_fk FOREIGN KEY
    (company_id,conversation_agent_id,conversation_run_id)
    REFERENCES heartbeat_runs(company_id,agent_id,id) ON DELETE RESTRICT,
  ADD CONSTRAINT orchestration_model_reservations_conversation_manifest_fk FOREIGN KEY
    (company_id,execution_manifest_id) REFERENCES agent_execution_manifests(company_id,id) ON DELETE RESTRICT,
  ADD CONSTRAINT orchestration_model_reservations_conversation_issue_fk FOREIGN KEY
    (company_id,conversation_issue_id) REFERENCES issues(company_id,id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX orchestration_model_reservation_conversation_key_uq
  ON orchestration_model_reservations(company_id,conversation_run_id,idempotency_key)
  WHERE conversation_run_id IS NOT NULL;
CREATE UNIQUE INDEX cost_events_native_conversation_reservation_uq
  ON cost_events(company_id,billing_code) WHERE billing_code LIKE 'native-conversation-model:%';
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
       OR i.conversation_retired_at IS NOT NULL OR i.execution_run_id IS DISTINCT FROM NEW.conversation_run_id OR i.status IS DISTINCT FROM 'in_review'
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
     OR i.conversation_retired_at IS NOT NULL OR i.execution_run_id IS DISTINCT FROM NEW.conversation_run_id OR i.status IS DISTINCT FROM 'in_review'
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
   WHERE company_id=NEW.company_id AND plan_id=NEW.plan_id;
 IF existing_total<>p.model_cost_reserved OR (p.budgets->'maxModelCostMinor'<>'null'::jsonb AND
   existing_total+NEW.maximum_minor>(p.budgets->>'maxModelCostMinor')::int)
 THEN RAISE EXCEPTION 'model_reservation_budget_exhausted' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v7_model_reservation_charge() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.plan_id IS NOT NULL THEN
   UPDATE orchestration_plans SET model_cost_reserved=model_cost_reserved+NEW.maximum_minor,
     verifier_calls_used=verifier_calls_used+CASE WHEN NEW.purpose IN ('read_only_verification','read_only_trajectory') THEN 1 ELSE 0 END,
     updated_at=clock_timestamp() WHERE company_id=NEW.company_id AND id=NEW.plan_id;
 END IF;
 RETURN NEW;
END; $$;
