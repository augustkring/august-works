CREATE TABLE "customer_feedback_experience_measures" (
	"company_id" uuid NOT NULL,
	"feedback_id" uuid NOT NULL,
	"satisfaction" text NOT NULL,
	"effort" text NOT NULL,
	"consented_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_feedback_experience_measures_pk" PRIMARY KEY("company_id","feedback_id"),
	CONSTRAINT "customer_feedback_experience_satisfaction_check" CHECK ("customer_feedback_experience_measures"."satisfaction" in ('very_dissatisfied','dissatisfied','neither','satisfied','very_satisfied')),
	CONSTRAINT "customer_feedback_experience_effort_check" CHECK ("customer_feedback_experience_measures"."effort" in ('very_difficult','difficult','neither','easy','very_easy'))
);
--> statement-breakpoint
ALTER TABLE "customer_feedback_experience_measures" ADD CONSTRAINT "customer_feedback_experience_measures_company_id_feedback_id_customer_feedback_company_id_id_fk" FOREIGN KEY ("company_id","feedback_id") REFERENCES "public"."customer_feedback"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_feedback_measure_withdrawal_once_idx" ON "customer_feedback_events" USING btree ("company_id","feedback_id") WHERE "customer_feedback_events"."link_type" = 'aw_feedback_measure_withdrawal_v1';--> statement-breakpoint
ALTER TABLE "customer_feedback_events" ADD CONSTRAINT "customer_feedback_measure_withdrawal_event_check" CHECK ("customer_feedback_events"."link_type" <> 'aw_feedback_measure_withdrawal_v1' OR (
        "customer_feedback_events"."kind" = 'product_message' AND "customer_feedback_events"."body" = '' AND "customer_feedback_events"."customer_visible" = false
        AND "customer_feedback_events"."link_id" IS NULL AND "customer_feedback_events"."internal_note" IS NOT DISTINCT FROM 'Optional experience ratings withdrawn by the submitter.'
      ));--> statement-breakpoint
CREATE FUNCTION aw_v10_customer_feedback_experience_measure_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    RAISE EXCEPTION 'Optional feedback experience ratings are immutable' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM customer_feedback f
    WHERE f.company_id=NEW.company_id AND f.id=NEW.feedback_id
      AND f.context->'experienceMeasure'->>'offered'='true'
      AND f.context->'experienceMeasure'->>'consent'='granted'
  ) THEN
    RAISE EXCEPTION 'Optional feedback ratings require the original consent marker' USING ERRCODE='23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM customer_feedback_events e
    WHERE e.company_id=NEW.company_id AND e.feedback_id=NEW.feedback_id
      AND e.link_type='aw_feedback_measure_withdrawal_v1'
  ) THEN
    RAISE EXCEPTION 'Withdrawn feedback ratings cannot be restored' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v10_customer_feedback_experience_measure_guard
BEFORE INSERT OR UPDATE ON customer_feedback_experience_measures
FOR EACH ROW EXECUTE FUNCTION aw_v10_customer_feedback_experience_measure_guard();
--> statement-breakpoint
CREATE FUNCTION aw_v10_customer_feedback_experience_withdrawal_event_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NEW.link_type='aw_feedback_measure_withdrawal_v1' AND NOT EXISTS (
    SELECT 1 FROM customer_feedback f
    WHERE f.company_id=NEW.company_id AND f.id=NEW.feedback_id
      AND f.context->'experienceMeasure'->>'offered'='true'
      AND f.context->'experienceMeasure'->>'consent'='granted'
  ) THEN
    RAISE EXCEPTION 'Feedback withdrawal marker requires original consent' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v10_customer_feedback_experience_withdrawal_event_guard
BEFORE INSERT ON customer_feedback_events
FOR EACH ROW EXECUTE FUNCTION aw_v10_customer_feedback_experience_withdrawal_event_guard();
--> statement-breakpoint
CREATE FUNCTION aw_v10_customer_feedback_experience_withdrawal_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF OLD.link_type='aw_feedback_measure_withdrawal_v1' AND pg_trigger_depth() <= 1 THEN
    RAISE EXCEPTION 'Feedback withdrawal markers are append-only' USING ERRCODE='23514';
  END IF;
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v10_customer_feedback_experience_withdrawal_immutable
BEFORE DELETE ON customer_feedback_events
FOR EACH ROW EXECUTE FUNCTION aw_v10_customer_feedback_experience_withdrawal_immutable();
