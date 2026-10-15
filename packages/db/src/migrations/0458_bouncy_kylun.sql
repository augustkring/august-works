ALTER TABLE "company_onboarding_runs" ADD COLUMN "activation_state" jsonb;
--> statement-breakpoint
CREATE FUNCTION aw_v9_onboarding_flow_fence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.activation_state IS NOT NULL AND (
    NEW.activation_state IS NULL OR NEW.answers IS DISTINCT FROM OLD.answers OR
    NEW.current_stage IS DISTINCT FROM ('v9_' || (NEW.activation_state->>'step')) OR
    NEW.version <> OLD.version + 1
  ) THEN
    RAISE EXCEPTION 'AW_V9_ONBOARDING_FLOW_REQUIRED';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER aw_v9_onboarding_flow_fence BEFORE UPDATE ON company_onboarding_runs
FOR EACH ROW EXECUTE FUNCTION aw_v9_onboarding_flow_fence();
