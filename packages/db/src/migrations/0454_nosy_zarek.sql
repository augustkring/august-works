ALTER TABLE "customer_feedback_access" DROP CONSTRAINT "customer_feedback_access_feedback_id_customer_feedback_id_fk";
--> statement-breakpoint
ALTER TABLE "customer_feedback_events" DROP CONSTRAINT "customer_feedback_events_feedback_id_customer_feedback_id_fk";
--> statement-breakpoint
ALTER TABLE "customer_feedback_events" ADD COLUMN "internal_note" text;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_feedback_company_id_idx" ON "customer_feedback" USING btree ("company_id","id");--> statement-breakpoint
ALTER TABLE "customer_feedback_access" ADD CONSTRAINT "customer_feedback_access_company_id_feedback_id_customer_feedback_company_id_id_fk" FOREIGN KEY ("company_id","feedback_id") REFERENCES "public"."customer_feedback"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_feedback_events" ADD CONSTRAINT "customer_feedback_events_company_id_feedback_id_customer_feedback_company_id_id_fk" FOREIGN KEY ("company_id","feedback_id") REFERENCES "public"."customer_feedback"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_feedback_events" ADD CONSTRAINT "customer_feedback_events_kind_check" CHECK ("customer_feedback_events"."kind" in ('customer_follow_up','product_message'));
--> statement-breakpoint
CREATE FUNCTION aw_v9_feedback_immutable_submission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'status' - 'version' - 'internal_state') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'version' - 'internal_state') THEN
    RAISE EXCEPTION 'Customer feedback submission is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Customer feedback version must advance once' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v9_feedback_submission_guard BEFORE UPDATE ON customer_feedback FOR EACH ROW EXECUTE FUNCTION aw_v9_feedback_immutable_submission();
--> statement-breakpoint
CREATE FUNCTION aw_v9_feedback_immutable_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Customer feedback events are append-only' USING ERRCODE='23514';
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v9_feedback_event_guard BEFORE UPDATE ON customer_feedback_events FOR EACH ROW EXECUTE FUNCTION aw_v9_feedback_immutable_event();
