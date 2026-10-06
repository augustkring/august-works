ALTER TABLE "work_signal_candidates" ADD COLUMN "followup_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "work_signal_candidates" ADD COLUMN "followup_error_code" text;--> statement-breakpoint
ALTER TABLE "work_signal_candidates" ADD COLUMN "followup_lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "work_signal_candidates" ADD CONSTRAINT "work_signal_followup_budget_check" CHECK ("work_signal_candidates"."followup_attempts" between 0 and 3);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v7_work_followup_budget_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.followup_attempts<OLD.followup_attempts THEN RAISE EXCEPTION 'work_signal_followup_budget_is_cumulative' USING ERRCODE='23514'; END IF;
 IF NEW.followup_error_code IS NOT NULL AND NEW.followup_error_code<>'native_review_delivery_failed' THEN RAISE EXCEPTION 'work_signal_error_code_is_content_free' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v7_work_followup_budget_guard BEFORE UPDATE ON work_signal_candidates FOR EACH ROW EXECUTE FUNCTION aw_v7_work_followup_budget_guard();
