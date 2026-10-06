CREATE TABLE "orchestration_model_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"worker_id" uuid,
	"worker_attempt_id" uuid,
	"purpose" text NOT NULL,
	"principal_user_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"input_hash" text NOT NULL,
	"authority_hash" text NOT NULL,
	"quote" jsonb NOT NULL,
	"maximum_minor" integer NOT NULL,
	"status" text DEFAULT 'reserved' NOT NULL,
	"provider_response_hash" text,
	"usage" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"dispatched_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orchestration_model_reservation_tenant_uq" UNIQUE("company_id","id"),
	CONSTRAINT "orchestration_model_reservation_key_uq" UNIQUE("company_id","plan_id","idempotency_key"),
	CONSTRAINT "orchestration_model_reservation_status_ck" CHECK ("orchestration_model_reservations"."status" in ('reserved','dispatched','completed','failed','unknown','cancelled')),
	CONSTRAINT "orchestration_model_reservation_purpose_ck" CHECK ("orchestration_model_reservations"."purpose" in ('worker_model','read_only_verification','read_only_trajectory')),
	CONSTRAINT "orchestration_model_reservation_cost_ck" CHECK ("orchestration_model_reservations"."maximum_minor" between 0 and 1000000 and ("orchestration_model_reservations"."quote"->>'maximumMinor')::int="orchestration_model_reservations"."maximum_minor" and "orchestration_model_reservations"."expires_at">"orchestration_model_reservations"."created_at"),
	CONSTRAINT "orchestration_model_reservation_hash_ck" CHECK ("orchestration_model_reservations"."request_hash" ~ '^[a-f0-9]{64}$' and "orchestration_model_reservations"."input_hash" ~ '^[a-f0-9]{64}$' and "orchestration_model_reservations"."authority_hash" ~ '^[a-f0-9]{64}$' and ("orchestration_model_reservations"."provider_response_hash" is null or "orchestration_model_reservations"."provider_response_hash" ~ '^[a-f0-9]{64}$'))
);
--> statement-breakpoint
ALTER TABLE "orchestration_model_reservations" ADD CONSTRAINT "orchestration_model_reservations_company_id_plan_id_orchestration_plans_company_id_id_fk" FOREIGN KEY ("company_id","plan_id") REFERENCES "public"."orchestration_plans"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orchestration_model_reservations" ADD CONSTRAINT "orchestration_model_reservations_company_id_plan_id_worker_id_orchestration_workers_company_id_plan_id_id_fk" FOREIGN KEY ("company_id","plan_id","worker_id") REFERENCES "public"."orchestration_workers"("company_id","plan_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orchestration_model_reservations" ADD CONSTRAINT "orchestration_model_reservations_company_id_plan_id_worker_attempt_id_orchestration_worker_attempts_company_id_plan_id_id_fk" FOREIGN KEY ("company_id","plan_id","worker_attempt_id") REFERENCES "public"."orchestration_worker_attempts"("company_id","plan_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orchestration_model_reservation_pending_idx" ON "orchestration_model_reservations" USING btree ("status","expires_at");
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
 IF p.id IS NULL OR p.erased_at IS NOT NULL OR p.status IN('completed','cancelled','failed') OR p.risk_class='C4' OR p.budgets->'maxModelCostMinor'='null'::jsonb
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
 IF NEW.worker_attempt_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM orchestration_worker_attempts WHERE company_id=NEW.company_id AND plan_id=NEW.plan_id AND id=NEW.worker_attempt_id AND worker_id=NEW.worker_id)
 THEN RAISE EXCEPTION 'model_reservation_attempt_scope' USING ERRCODE='23514'; END IF;
 SELECT coalesce(sum(maximum_minor),0) INTO existing_total FROM orchestration_model_reservations WHERE company_id=NEW.company_id AND plan_id=NEW.plan_id;
 IF existing_total<>p.model_cost_reserved OR existing_total+NEW.maximum_minor>(p.budgets->>'maxModelCostMinor')::int
 THEN RAISE EXCEPTION 'model_reservation_budget_exhausted' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER aw_v7_model_reservation_guard BEFORE INSERT OR UPDATE OR DELETE ON orchestration_model_reservations FOR EACH ROW EXECUTE FUNCTION aw_v7_model_reservation_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v7_model_reservation_charge() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE orchestration_plans SET model_cost_reserved=model_cost_reserved+NEW.maximum_minor,updated_at=clock_timestamp() WHERE company_id=NEW.company_id AND id=NEW.plan_id;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER aw_v7_model_reservation_charge AFTER INSERT ON orchestration_model_reservations FOR EACH ROW EXECUTE FUNCTION aw_v7_model_reservation_charge();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v7_model_budget_counter_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ledger_total bigint;
BEGIN
 IF NEW.model_cost_reserved=OLD.model_cost_reserved THEN RETURN NEW; END IF;
 SELECT coalesce(sum(maximum_minor),0) INTO ledger_total FROM orchestration_model_reservations WHERE company_id=NEW.company_id AND plan_id=NEW.id;
 IF NEW.model_cost_reserved<>ledger_total OR NEW.model_cost_reserved<OLD.model_cost_reserved
   OR (NEW.budgets->'maxModelCostMinor'<>'null'::jsonb AND NEW.model_cost_reserved>(NEW.budgets->>'maxModelCostMinor')::int)
 THEN RAISE EXCEPTION 'model_budget_counter_requires_native_reservations' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER aw_v7_model_budget_counter_guard BEFORE UPDATE OF model_cost_reserved ON orchestration_plans FOR EACH ROW EXECUTE FUNCTION aw_v7_model_budget_counter_guard();
