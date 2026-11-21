ALTER TABLE "orchestration_company_purpose_reservations" ADD COLUMN "provider_wire_receipt" jsonb;--> statement-breakpoint
ALTER TABLE "orchestration_model_reservations" ADD COLUMN "provider_wire_receipt" jsonb;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v10_provider_wire_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt jsonb; expected_endpoint text; expected_call_id boolean; receipt_key_count integer;
BEGIN
  receipt := NEW.provider_wire_receipt;
  IF OLD.provider_wire_receipt IS NOT NULL AND receipt IS DISTINCT FROM OLD.provider_wire_receipt THEN
    RAISE EXCEPTION 'model_provider_wire_receipt_immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.provider_wire_receipt IS NULL AND receipt IS NOT NULL THEN
    receipt_key_count := -1;
    IF jsonb_typeof(receipt) = 'object' THEN
      SELECT count(*) INTO receipt_key_count FROM jsonb_object_keys(receipt);
    END IF;
    expected_endpoint := CASE
      WHEN NEW.purpose IN ('decision_shadow','decision_skill_suggestion') AND NEW.quote->>'provider' = 'openrouter'
        THEN 'https://openrouter.ai/api/alpha/decisions'
      WHEN NEW.purpose NOT IN ('decision_shadow','decision_skill_suggestion') AND NEW.quote->>'provider' = 'anthropic'
        THEN 'https://api.anthropic.com/v1/messages'
      ELSE NULL END;
    expected_call_id := TG_TABLE_NAME = 'orchestration_model_reservations'
      AND NEW.purpose IN ('worker_model','conversation_model');
    IF NEW.status <> 'dispatched' OR jsonb_typeof(receipt) <> 'object' OR receipt_key_count <> 7
      OR jsonb_typeof(receipt->'version') <> 'number' OR receipt->>'version' <> '1'
      OR jsonb_typeof(receipt->'reservationId') <> 'string'
      OR receipt->>'reservationId' <> NEW.id::text
      OR jsonb_typeof(receipt->'requestHash') <> 'string'
      OR receipt->>'requestHash' <> NEW.request_hash
      OR jsonb_typeof(receipt->'method') <> 'string'
      OR receipt->>'method' <> 'POST'
      OR jsonb_typeof(receipt->'endpoint') <> 'string'
      OR receipt->>'endpoint' IS DISTINCT FROM expected_endpoint
      OR jsonb_typeof(receipt->'bodySha256') <> 'string'
      OR coalesce(receipt->>'bodySha256','') !~ '^[a-f0-9]{64}$'
      OR (expected_call_id AND (jsonb_typeof(receipt->'callId') <> 'string' OR coalesce(receipt->>'callId','') = '' OR length(receipt->>'callId') > 200))
      OR (NOT expected_call_id AND receipt->'callId' IS DISTINCT FROM 'null'::jsonb) THEN
      RAISE EXCEPTION 'model_provider_wire_receipt_invalid' USING ERRCODE='23514';
    END IF;
  END IF;
  IF OLD.status <> 'completed' AND NEW.status = 'completed' AND receipt IS NULL THEN
    RAISE EXCEPTION 'model_provider_wire_receipt_required' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER orchestration_model_reservation_wire_receipt_guard
  BEFORE UPDATE ON orchestration_model_reservations
  FOR EACH ROW EXECUTE FUNCTION aw_v10_provider_wire_receipt_guard();
--> statement-breakpoint
CREATE TRIGGER orchestration_company_purpose_reservation_wire_receipt_guard
  BEFORE UPDATE ON orchestration_company_purpose_reservations
  FOR EACH ROW EXECUTE FUNCTION aw_v10_provider_wire_receipt_guard();
