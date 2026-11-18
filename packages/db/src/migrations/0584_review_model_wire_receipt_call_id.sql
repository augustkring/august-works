-- MS1h11. A review_model dispatch records its exact provider call ID, as
-- worker_model and conversation_model do (recordWireDispatch in
-- server/src/services/orchestration/model-reservations.ts). 0553 predates
-- review_model (0576), so this guard refused a review_model receipt with a
-- string callId. Only the purpose list for expected_call_id changes; the
-- rest is 0553's definition. The triggers from 0553 keep calling it.
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
      AND NEW.purpose IN ('worker_model','review_model','conversation_model');
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
