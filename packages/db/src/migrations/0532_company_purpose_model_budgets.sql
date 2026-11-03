CREATE TABLE "orchestration_company_purpose_budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"funder" text NOT NULL,
	"profile_id" text NOT NULL,
	"profile_hash" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"credential_binding_hash" text NOT NULL,
	"period_key" text NOT NULL,
	"period_starts_at" timestamp with time zone NOT NULL,
	"period_ends_at" timestamp with time zone NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"source_sha" text NOT NULL,
	"qualification_hash" text NOT NULL,
	"tariff_hash" text NOT NULL,
	"max_cost_minor" integer NOT NULL,
	"reserved_minor" integer DEFAULT 0 NOT NULL,
	"max_calls" integer NOT NULL,
	"reserved_calls" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orchestration_company_purpose_budget_tenant_uq" UNIQUE("company_id","id"),
	CONSTRAINT "orchestration_company_purpose_budget_period_uq" UNIQUE("company_id","purpose","profile_id","period_key"),
	CONSTRAINT "orchestration_company_purpose_budget_contract_ck" CHECK ("orchestration_company_purpose_budgets"."purpose"='first_party_support' and "orchestration_company_purpose_budgets"."funder"='blentera_platform' and "orchestration_company_purpose_budgets"."profile_id" ~ '^[a-zA-Z0-9._:-]{1,120}$' and "orchestration_company_purpose_budgets"."profile_hash" ~ '^[a-f0-9]{64}$' and "orchestration_company_purpose_budgets"."provider_account_id" ~ '^[a-zA-Z0-9._:-]{1,160}$' and "orchestration_company_purpose_budgets"."credential_binding_hash" ~ '^[a-f0-9]{64}$' and "orchestration_company_purpose_budgets"."period_key" ~ '^[a-zA-Z0-9._:-]{1,120}$' and "orchestration_company_purpose_budgets"."period_starts_at"<"orchestration_company_purpose_budgets"."period_ends_at" and "orchestration_company_purpose_budgets"."period_ends_at"<="orchestration_company_purpose_budgets"."period_starts_at"+interval '366 days' and "orchestration_company_purpose_budgets"."provider" in ('openai','anthropic','openrouter') and length("orchestration_company_purpose_budgets"."model") between 1 and 200 and "orchestration_company_purpose_budgets"."source_sha" ~ '^[a-f0-9]{40}$' and "orchestration_company_purpose_budgets"."qualification_hash" ~ '^[a-f0-9]{64}$' and "orchestration_company_purpose_budgets"."tariff_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "orchestration_company_purpose_budget_amount_ck" CHECK ("orchestration_company_purpose_budgets"."max_cost_minor" between 1 and 1000000 and "orchestration_company_purpose_budgets"."reserved_minor" between 0 and "orchestration_company_purpose_budgets"."max_cost_minor" and "orchestration_company_purpose_budgets"."max_calls" between 1 and 10000 and "orchestration_company_purpose_budgets"."reserved_calls" between 0 and "orchestration_company_purpose_budgets"."max_calls")
);
--> statement-breakpoint
CREATE TABLE "orchestration_company_purpose_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"budget_id" uuid NOT NULL,
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
	CONSTRAINT "orchestration_company_purpose_reservation_tenant_uq" UNIQUE("company_id","id"),
	CONSTRAINT "orchestration_company_purpose_reservation_key_uq" UNIQUE("company_id","idempotency_key"),
	CONSTRAINT "orchestration_company_purpose_reservation_status_ck" CHECK ("orchestration_company_purpose_reservations"."status" in ('reserved','dispatched','completed','failed','unknown','cancelled')),
	CONSTRAINT "orchestration_company_purpose_reservation_cost_ck" CHECK ("orchestration_company_purpose_reservations"."maximum_minor" between 0 and 1000000 and ("orchestration_company_purpose_reservations"."quote"->>'maximumMinor')::int="orchestration_company_purpose_reservations"."maximum_minor" and "orchestration_company_purpose_reservations"."expires_at">"orchestration_company_purpose_reservations"."created_at"),
	CONSTRAINT "orchestration_company_purpose_reservation_hash_ck" CHECK ("orchestration_company_purpose_reservations"."request_hash" ~ '^[a-f0-9]{64}$' and "orchestration_company_purpose_reservations"."input_hash" ~ '^[a-f0-9]{64}$' and "orchestration_company_purpose_reservations"."authority_hash" ~ '^[a-f0-9]{64}$' and ("orchestration_company_purpose_reservations"."provider_response_hash" is null or "orchestration_company_purpose_reservations"."provider_response_hash" ~ '^[a-f0-9]{64}$'))
);
--> statement-breakpoint
ALTER TABLE "orchestration_company_purpose_budgets" ADD CONSTRAINT "orchestration_company_purpose_budgets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orchestration_company_purpose_reservations" ADD CONSTRAINT "orchestration_company_purpose_reservations_company_id_budget_id_orchestration_company_purpose_budgets_company_id_id_fk" FOREIGN KEY ("company_id","budget_id") REFERENCES "public"."orchestration_company_purpose_budgets"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orchestration_company_purpose_budget_period_idx" ON "orchestration_company_purpose_budgets" USING btree ("period_ends_at");--> statement-breakpoint
CREATE INDEX "orchestration_company_purpose_reservation_pending_idx" ON "orchestration_company_purpose_reservations" USING btree ("status","expires_at");
--> statement-breakpoint
-- Native guards keep the taskless platform-purpose ledger separate from and
-- just as conservative as the existing plan-backed model reservation ledger.

CREATE OR REPLACE FUNCTION aw_v10_company_purpose_budget_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ledger_total bigint; ledger_calls bigint;
BEGIN
  IF TG_OP='DELETE' THEN
    IF NOT EXISTS(SELECT 1 FROM companies c WHERE c.id=OLD.company_id
      AND c.pause_reason='company_deleted'
      AND c.content_erasure_transaction_id=pg_current_xact_id()::text)
      OR EXISTS(SELECT 1 FROM orchestration_company_purpose_reservations r
        WHERE r.company_id=OLD.company_id AND r.budget_id=OLD.id)
    THEN RAISE EXCEPTION 'company_purpose_budget_retained' USING ERRCODE='23514'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='INSERT' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text || ':' || NEW.purpose,0));
    PERFORM 1 FROM companies c WHERE c.id=NEW.company_id AND c.status='active' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'company_purpose_company_closed' USING ERRCODE='23514'; END IF;
    IF NEW.reserved_minor<>0 OR NEW.reserved_calls<>0 OR NEW.period_starts_at>clock_timestamp()
      OR NEW.period_ends_at<=clock_timestamp()
      OR NEW.period_ends_at>NEW.period_starts_at+interval '366 days'
    THEN RAISE EXCEPTION 'company_purpose_budget_period_closed' USING ERRCODE='23514'; END IF;
    IF EXISTS(SELECT 1 FROM orchestration_company_purpose_budgets prior
      WHERE prior.company_id=NEW.company_id AND prior.purpose=NEW.purpose
        AND prior.period_starts_at<NEW.period_ends_at
        AND prior.period_ends_at>NEW.period_starts_at
        AND NOT (prior.profile_id=NEW.profile_id AND prior.period_key=NEW.period_key
          AND prior.period_starts_at=NEW.period_starts_at AND prior.period_ends_at=NEW.period_ends_at))
    THEN RAISE EXCEPTION 'company_purpose_budget_period_overlap' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id,NEW.company_id,NEW.purpose,NEW.funder,NEW.profile_id,NEW.profile_hash,NEW.period_key,
      NEW.provider_account_id,NEW.credential_binding_hash,
      NEW.period_starts_at,NEW.period_ends_at,NEW.provider,NEW.model,NEW.source_sha,
      NEW.qualification_hash,NEW.tariff_hash,NEW.max_cost_minor,NEW.max_calls,NEW.created_at)
     IS DISTINCT FROM
     (OLD.id,OLD.company_id,OLD.purpose,OLD.funder,OLD.profile_id,OLD.profile_hash,OLD.period_key,
      OLD.provider_account_id,OLD.credential_binding_hash,
      OLD.period_starts_at,OLD.period_ends_at,OLD.provider,OLD.model,OLD.source_sha,
      OLD.qualification_hash,OLD.tariff_hash,OLD.max_cost_minor,OLD.max_calls,OLD.created_at)
  THEN RAISE EXCEPTION 'company_purpose_budget_contract_immutable' USING ERRCODE='23514'; END IF;
  IF NEW.reserved_minor=OLD.reserved_minor AND NEW.reserved_calls=OLD.reserved_calls THEN RETURN NEW; END IF;
  SELECT coalesce(sum(maximum_minor),0),count(*) INTO ledger_total,ledger_calls
    FROM orchestration_company_purpose_reservations
    WHERE company_id=NEW.company_id AND budget_id=NEW.id;
  IF NEW.reserved_minor<>ledger_total OR NEW.reserved_minor<OLD.reserved_minor
    OR NEW.reserved_minor>NEW.max_cost_minor OR NEW.reserved_calls<>ledger_calls
    OR NEW.reserved_calls<OLD.reserved_calls OR NEW.reserved_calls>NEW.max_calls
  THEN RAISE EXCEPTION 'company_purpose_budget_counter_requires_reservations' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER aw_v10_company_purpose_budget_guard
  BEFORE INSERT OR UPDATE OR DELETE ON orchestration_company_purpose_budgets
  FOR EACH ROW EXECUTE FUNCTION aw_v10_company_purpose_budget_guard();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION aw_v10_company_purpose_reservation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b orchestration_company_purpose_budgets; existing_total bigint; existing_calls bigint;
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.status IN('reserved','dispatched','unknown') OR NOT EXISTS(
      SELECT 1 FROM companies c WHERE c.id=OLD.company_id AND c.pause_reason='company_deleted'
        AND c.content_erasure_transaction_id=pg_current_xact_id()::text)
    THEN RAISE EXCEPTION 'company_purpose_reservation_retained' USING ERRCODE='23514'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.usage IS NOT NULL AND NOT coalesce(CASE
      WHEN jsonb_typeof(NEW.usage)='object' THEN
        NEW.usage ?& ARRAY['inputTokens','outputTokens']
        AND (NEW.usage-ARRAY['inputTokens','outputTokens'])='{}'::jsonb
        AND CASE WHEN NEW.usage->>'inputTokens' ~ '^[0-9]{1,10}$'
          THEN (NEW.usage->>'inputTokens')::numeric<=2147483647 ELSE false END
        AND CASE WHEN NEW.usage->>'outputTokens' ~ '^[0-9]{1,10}$'
          THEN (NEW.usage->>'outputTokens')::numeric<=2147483647 ELSE false END
      ELSE false END,false)
    THEN RAISE EXCEPTION 'company_purpose_reservation_usage_closed' USING ERRCODE='23514'; END IF;
    IF (NEW.id,NEW.company_id,NEW.budget_id,NEW.principal_user_id,NEW.idempotency_key,
        NEW.request_hash,NEW.input_hash,NEW.authority_hash,NEW.quote,NEW.maximum_minor,
        NEW.expires_at,NEW.created_at)
       IS DISTINCT FROM
       (OLD.id,OLD.company_id,OLD.budget_id,OLD.principal_user_id,OLD.idempotency_key,
        OLD.request_hash,OLD.input_hash,OLD.authority_hash,OLD.quote,OLD.maximum_minor,
        OLD.expires_at,OLD.created_at)
    THEN RAISE EXCEPTION 'company_purpose_reservation_inputs_immutable' USING ERRCODE='23514'; END IF;
    IF OLD.status=NEW.status THEN
      IF (NEW.dispatched_at,NEW.completed_at,NEW.provider_response_hash,NEW.usage)
         IS DISTINCT FROM (OLD.dispatched_at,OLD.completed_at,OLD.provider_response_hash,OLD.usage)
      THEN RAISE EXCEPTION 'company_purpose_reservation_receipt_immutable' USING ERRCODE='23514'; END IF;
      RETURN NEW;
    END IF;
    IF OLD.status='unknown' AND NEW.status IN('completed','failed') THEN
      IF OLD.provider_response_hash IS NOT NULL OR OLD.usage IS NOT NULL
        OR NEW.provider_response_hash IS NULL OR NEW.usage IS NULL OR NEW.completed_at IS NULL
        OR (NEW.usage->>'inputTokens')::numeric>(OLD.quote->>'inputTokensUpperBound')::numeric
        OR (NEW.usage->>'outputTokens')::numeric>(OLD.quote->>'maxOutputTokens')::numeric
      THEN RAISE EXCEPTION 'company_purpose_late_outcome_closed' USING ERRCODE='23514'; END IF;
      RETURN NEW;
    END IF;
    IF NOT ((OLD.status='reserved' AND NEW.status IN('dispatched','cancelled'))
      OR (OLD.status='dispatched' AND NEW.status IN('completed','failed','unknown')))
      OR (OLD.status='dispatched' AND NEW.dispatched_at IS DISTINCT FROM OLD.dispatched_at)
      OR (NEW.status='dispatched' AND (NEW.dispatched_at IS NULL OR NEW.completed_at IS NOT NULL
        OR NEW.provider_response_hash IS NOT NULL OR NEW.usage IS NOT NULL))
      OR (NEW.status IN('completed','failed','unknown','cancelled') AND NEW.completed_at IS NULL)
    THEN RAISE EXCEPTION 'company_purpose_reservation_transition_closed' USING ERRCODE='23514'; END IF;
    IF NEW.status='dispatched' THEN
      PERFORM 1 FROM companies c WHERE c.id=NEW.company_id AND c.status='active' FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'company_purpose_company_closed' USING ERRCODE='23514'; END IF;
      SELECT * INTO b FROM orchestration_company_purpose_budgets
        WHERE company_id=NEW.company_id AND id=NEW.budget_id FOR SHARE;
      IF b.id IS NULL OR b.period_ends_at<=clock_timestamp() OR NEW.expires_at<=clock_timestamp()
        OR NEW.quote->>'provider' IS DISTINCT FROM b.provider
        OR NEW.quote->>'model' IS DISTINCT FROM b.model
        OR NEW.quote->>'sourceSha' IS DISTINCT FROM b.source_sha
        OR NEW.quote->>'qualificationHash' IS DISTINCT FROM b.qualification_hash
        OR NEW.quote->>'tariffHash' IS DISTINCT FROM b.tariff_hash
      THEN RAISE EXCEPTION 'company_purpose_dispatch_contract_closed' USING ERRCODE='23514'; END IF;
    END IF;
    RETURN NEW;
  END IF;
  PERFORM 1 FROM companies c WHERE c.id=NEW.company_id AND c.status='active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'company_purpose_company_closed' USING ERRCODE='23514'; END IF;
  SELECT * INTO b FROM orchestration_company_purpose_budgets
    WHERE company_id=NEW.company_id AND id=NEW.budget_id FOR UPDATE;
  IF b.id IS NULL OR b.purpose<>'first_party_support' OR b.funder<>'blentera_platform'
    OR b.period_starts_at>clock_timestamp() OR b.period_ends_at<=clock_timestamp()
    OR NEW.status<>'reserved' OR NEW.dispatched_at IS NOT NULL OR NEW.completed_at IS NOT NULL
    OR NEW.provider_response_hash IS NOT NULL OR NEW.usage IS NOT NULL
    OR NEW.expires_at<=clock_timestamp() OR NEW.expires_at>b.period_ends_at
    OR NEW.expires_at>NEW.created_at+interval '5 minutes'
    OR NOT coalesce(jsonb_typeof(NEW.quote)='object' AND NEW.quote->>'version'='1'
      AND NEW.quote->>'currency'='USD' AND NEW.quote->>'provider' IN('openai','anthropic','openrouter')
      AND length(NEW.quote->>'model') BETWEEN 1 AND 200
      AND (NEW.quote->>'maximumMinor')::int=NEW.maximum_minor
      AND (NEW.quote->>'inputTokensUpperBound')::int BETWEEN 1 AND 2000000
      AND (NEW.quote->>'maxOutputTokens')::int BETWEEN 1 AND 65536
      AND NEW.quote->>'sourceSha' ~ '^[a-f0-9]{40}$'
      AND NEW.quote->>'tariffHash' ~ '^[a-f0-9]{64}$'
      AND NEW.quote->>'qualificationHash' ~ '^[a-f0-9]{64}$'
      AND (NEW.quote->>'expiresAt')::timestamptz>=NEW.expires_at,false)
    OR NEW.quote->>'provider' IS DISTINCT FROM b.provider
    OR NEW.quote->>'model' IS DISTINCT FROM b.model
    OR NEW.quote->>'sourceSha' IS DISTINCT FROM b.source_sha
    OR NEW.quote->>'qualificationHash' IS DISTINCT FROM b.qualification_hash
    OR NEW.quote->>'tariffHash' IS DISTINCT FROM b.tariff_hash
  THEN RAISE EXCEPTION 'company_purpose_reservation_scope_closed' USING ERRCODE='23514'; END IF;
  SELECT coalesce(sum(maximum_minor),0),count(*) INTO existing_total,existing_calls
    FROM orchestration_company_purpose_reservations
    WHERE company_id=NEW.company_id AND budget_id=NEW.budget_id;
  IF existing_total<>b.reserved_minor OR existing_calls<>b.reserved_calls
    OR existing_total+NEW.maximum_minor>b.max_cost_minor OR existing_calls+1>b.max_calls
  THEN RAISE EXCEPTION 'company_purpose_reservation_budget_exhausted' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER aw_v10_company_purpose_reservation_guard
  BEFORE INSERT OR UPDATE OR DELETE ON orchestration_company_purpose_reservations
  FOR EACH ROW EXECUTE FUNCTION aw_v10_company_purpose_reservation_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v10_company_purpose_reservation_charge() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE orchestration_company_purpose_budgets
    SET reserved_minor=reserved_minor+NEW.maximum_minor,reserved_calls=reserved_calls+1
    WHERE company_id=NEW.company_id AND id=NEW.budget_id;
  RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER aw_v10_company_purpose_reservation_charge
  AFTER INSERT ON orchestration_company_purpose_reservations
  FOR EACH ROW EXECUTE FUNCTION aw_v10_company_purpose_reservation_charge();
