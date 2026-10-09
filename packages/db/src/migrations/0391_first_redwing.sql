ALTER TABLE "business_events" ADD COLUMN "governance_obligation_refs_json" jsonb;--> statement-breakpoint
ALTER TABLE "business_events" ADD COLUMN "retention_days" integer;--> statement-breakpoint
ALTER TABLE "business_events" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "business_events_expiry_idx" ON "business_events" USING btree ("expires_at","company_id");--> statement-breakpoint
ALTER TABLE "business_events" ADD CONSTRAINT "business_events_admission_check" CHECK ((
    ("business_events"."governance_obligation_refs_json" is null and "business_events"."retention_days" is null and "business_events"."expires_at" is null)
    or ("business_events"."governance_obligation_refs_json" is not null and jsonb_typeof("business_events"."governance_obligation_refs_json")='array'
      and jsonb_array_length("business_events"."governance_obligation_refs_json") between 1 and 32
      and "business_events"."retention_days" is not null and "business_events"."retention_days" between 1 and 3650
      and "business_events"."expires_at" is not null and "business_events"."expires_at">"business_events"."observed_at")
  ));
--> statement-breakpoint
CREATE FUNCTION aw_business_event_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW)-'tombstoned_at') IS DISTINCT FROM (to_jsonb(OLD)-'tombstoned_at')
    OR (OLD.tombstoned_at IS NOT NULL AND NEW.tombstoned_at IS DISTINCT FROM OLD.tombstoned_at) THEN
    RAISE EXCEPTION 'Business Event facts and purpose are immutable; append a revision or erase the source' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER business_events_immutable BEFORE UPDATE ON business_events FOR EACH ROW EXECUTE FUNCTION aw_business_event_immutable();
