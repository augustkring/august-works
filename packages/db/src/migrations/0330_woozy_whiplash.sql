ALTER TABLE "company_skill_test_runs" ADD COLUMN "evaluation_context" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "company_skill_test_runs_eval_binding_uq" ON "company_skill_test_runs" USING btree ("company_id",("evaluation_context"->>'evaluationRunId'),("evaluation_context"->>'caseId'),("evaluation_context"->>'arm'),("evaluation_context"->>'trial')) WHERE "company_skill_test_runs"."evaluation_context" is not null;
--> statement-breakpoint
CREATE FUNCTION aw_v5_guard_eval_case() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM company_skill_eval_suites WHERE id = OLD.suite_id) THEN
    RAISE EXCEPTION 'Evaluation cases are immutable; create a new pinned case set' USING ERRCODE = '23514', CONSTRAINT = 'aw_v5_eval_case_immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v5_eval_case_immutable BEFORE UPDATE OR DELETE ON company_skill_eval_cases FOR EACH ROW EXECUTE FUNCTION aw_v5_guard_eval_case();
