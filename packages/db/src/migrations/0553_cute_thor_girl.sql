ALTER TABLE "orchestration_company_purpose_reservations" ADD COLUMN "provider_wire_receipt" jsonb;--> statement-breakpoint
ALTER TABLE "orchestration_model_reservations" ADD COLUMN "provider_wire_receipt" jsonb;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v10_provider_wire_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt jsonb; expected_endpoint text; expected_call_id boolean;
BEGIN
  receipt := NEW.provider_wire_receipt;
  IF OLD.provider_wire_receipt IS NOT NULL AND receipt IS DISTINCT FROM OLD.provider_wire_receipt THEN
    RAISE EXCEPTION 'model_provider_wire_receipt_immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.provider_wire_receipt IS NULL AND receipt IS NOT NULL THEN
    expected_endpoint := CASE NEW.quote->>'provider'
      WHEN 'anthropic' THEN 'https://api.anthropic.com/v1/messages'
      WHEN 'openrouter' THEN 'https://openrouter.ai/api/v1/chat/completions'
      ELSE NULL END;
    expected_call_id := TG_TABLE_NAME = 'orchestration_model_reservations'
      AND NEW.purpose IN ('worker_model','conversation_model');
    IF NEW.status <> 'dispatched' OR jsonb_typeof(receipt) <> 'object' OR jsonb_object_length(receipt) <> 7
      OR receipt->>'version' <> '1'
      OR receipt->>'reservationId' <> NEW.id::text
      OR receipt->>'requestHash' <> NEW.request_hash
      OR receipt->>'method' <> 'POST'
      OR receipt->>'endpoint' IS DISTINCT FROM expected_endpoint
      OR coalesce(receipt->>'bodySha256','') !~ '^[a-f0-9]{64}$'
      OR (expected_call_id AND coalesce(receipt->>'callId','') = '')
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
