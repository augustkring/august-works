ALTER TABLE "customer_operations" DROP CONSTRAINT "customer_operations_state_check";--> statement-breakpoint
ALTER TABLE "orchestration_company_purpose_budgets" DROP CONSTRAINT "orchestration_company_purpose_budget_contract_ck";--> statement-breakpoint
ALTER TABLE "orchestration_company_purpose_reservations" ADD COLUMN "purpose" text DEFAULT 'first_party_support' NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_operations" ADD CONSTRAINT "customer_operations_state_check" CHECK ("customer_operations"."status" in ('running','cancelled','succeeded','failed','needs_reconciliation'));--> statement-breakpoint
ALTER TABLE "orchestration_company_purpose_budgets" ADD CONSTRAINT "orchestration_company_purpose_budget_contract_ck" CHECK ("orchestration_company_purpose_budgets"."purpose" in ('first_party_support','decision_skill_suggestion') and (("orchestration_company_purpose_budgets"."purpose"='first_party_support' and "orchestration_company_purpose_budgets"."funder"='blentera_platform') or ("orchestration_company_purpose_budgets"."purpose"='decision_skill_suggestion' and "orchestration_company_purpose_budgets"."funder"='company_connection')) and "orchestration_company_purpose_budgets"."profile_id" ~ '^[a-zA-Z0-9._:-]{1,120}$' and "orchestration_company_purpose_budgets"."profile_hash" ~ '^[a-f0-9]{64}$' and "orchestration_company_purpose_budgets"."provider_account_id" ~ '^[a-zA-Z0-9._:-]{1,160}$' and "orchestration_company_purpose_budgets"."credential_binding_hash" ~ '^[a-f0-9]{64}$' and "orchestration_company_purpose_budgets"."period_key" ~ '^[a-zA-Z0-9._:-]{1,120}$' and "orchestration_company_purpose_budgets"."period_starts_at"<"orchestration_company_purpose_budgets"."period_ends_at" and "orchestration_company_purpose_budgets"."period_ends_at"<="orchestration_company_purpose_budgets"."period_starts_at"+interval '366 days' and "orchestration_company_purpose_budgets"."provider" in ('openai','anthropic','openrouter') and length("orchestration_company_purpose_budgets"."model") between 1 and 200 and "orchestration_company_purpose_budgets"."source_sha" ~ '^[a-f0-9]{40}$' and "orchestration_company_purpose_budgets"."qualification_hash" ~ '^[a-f0-9]{64}$' and "orchestration_company_purpose_budgets"."tariff_hash" ~ '^[a-f0-9]{64}$');--> statement-breakpoint
ALTER TABLE "orchestration_company_purpose_reservations" ADD CONSTRAINT "orchestration_company_purpose_reservation_purpose_ck" CHECK ("orchestration_company_purpose_reservations"."purpose" in ('first_party_support','decision_skill_suggestion'));
--> statement-breakpoint
-- Keep the existing native reservation state machine and budget serialization.
-- Only the registered Jev purpose/funder pair is added; Support remains pinned
-- to its published first-party package release at both admission and dispatch.
DO $migration$
DECLARE definition text;
BEGIN
  definition := pg_get_functiondef('aw_v10_company_purpose_reservation_guard()'::regprocedure);
  definition := replace(definition,
    'IF b.id IS NULL OR b.purpose<>''first_party_support'' OR b.funder<>''blentera_platform''',
    'IF b.id IS NULL OR b.purpose IS DISTINCT FROM NEW.purpose OR (NEW.purpose=''first_party_support'' AND b.funder<>''blentera_platform'') OR (NEW.purpose=''decision_skill_suggestion'' AND b.funder<>''company_connection'')');
  definition := replace(definition, 'NEW.id,NEW.company_id,NEW.budget_id,NEW.principal_user_id', 'NEW.id,NEW.company_id,NEW.budget_id,NEW.purpose,NEW.principal_user_id');
  definition := replace(definition, 'OLD.id,OLD.company_id,OLD.budget_id,OLD.principal_user_id', 'OLD.id,OLD.company_id,OLD.budget_id,OLD.purpose,OLD.principal_user_id');
  IF definition NOT LIKE '%b.purpose IS DISTINCT FROM NEW.purpose%' OR definition NOT LIKE '%NEW.purpose,NEW.principal_user_id%' THEN
    RAISE EXCEPTION 'company_purpose_reservation_guard_source_changed';
  END IF;
  EXECUTE definition;

  definition := pg_get_functiondef('aw_v10_company_purpose_package_pin_guard()'::regprocedure);
  definition := replace(definition,
    'IF TG_OP=''INSERT'' AND NEW.package_version_id IS NULL THEN',
    'IF TG_OP=''INSERT'' AND NEW.package_version_id IS NULL AND NEW.purpose=''first_party_support'' THEN');
  definition := replace(definition,
    'IF TG_OP=''INSERT'' OR (TG_OP=''UPDATE'' AND NEW.status=''dispatched'' AND OLD.status IS DISTINCT FROM ''dispatched'') THEN',
    'IF (TG_OP=''INSERT'' OR (TG_OP=''UPDATE'' AND NEW.status=''dispatched'' AND OLD.status IS DISTINCT FROM ''dispatched'')) AND NEW.purpose=''first_party_support'' THEN');
  IF definition NOT LIKE '%NEW.package_version_id IS NULL AND NEW.purpose=''first_party_support''%'
     OR definition NOT LIKE '%AND NEW.purpose=''first_party_support'' THEN%' THEN
    RAISE EXCEPTION 'company_purpose_package_guard_source_changed';
  END IF;
  EXECUTE definition;
END
$migration$;
