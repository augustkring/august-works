ALTER TABLE "agent_configuration_drafts" ADD COLUMN "save_sequence" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_configuration_drafts" ADD CONSTRAINT "agent_configuration_drafts_save_sequence_check" CHECK ("agent_configuration_drafts"."save_sequence">=0);
--> statement-breakpoint
-- Appended to the actual generated migration for the canonical save sequence.
-- Navigation and no-op saves cannot silently change a tested candidate.
CREATE OR REPLACE FUNCTION aw_v9_agent_configuration_draft_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.kind='custom' AND NEW.step NOT IN ('outcome','identity','instructions','knowledge','tools','authority','memory','collaboration','runtime','test','review','publish','monitor'))
 OR (NEW.kind='hire' AND NEW.step NOT IN ('hire_access','hire_authority','hire_test','hire_review','hire_receipt')) THEN
  RAISE EXCEPTION 'agent_configuration_draft_step_invalid' USING ERRCODE='23514';
 END IF;
 IF TG_OP='INSERT' AND NEW.kind='hire' AND NOT EXISTS (
  SELECT 1 FROM agent_package_versions v JOIN agent_packages p ON p.id=v.agent_package_id
  WHERE v.id=NEW.package_version_id AND p.package_key=NEW.package_key AND v.content_hash=NEW.package_content_hash
 ) THEN
  RAISE EXCEPTION 'hire_source_pin_invalid' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' THEN
  IF (NEW.id,NEW.company_id,NEW.agent_id,NEW.created_by_user_id,NEW.creation_request_id,NEW.creation_request_hash,NEW.baseline_hash,NEW.created_at,NEW.kind,NEW.package_version_id,NEW.package_key,NEW.package_content_hash)
      IS DISTINCT FROM (OLD.id,OLD.company_id,OLD.agent_id,OLD.created_by_user_id,OLD.creation_request_id,OLD.creation_request_hash,OLD.baseline_hash,OLD.created_at,OLD.kind,OLD.package_version_id,OLD.package_key,OLD.package_content_hash) THEN
   RAISE EXCEPTION 'agent_configuration_draft_scope_immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.status='discarded' OR NEW.save_sequence NOT IN (OLD.save_sequence,OLD.save_sequence+1) THEN
   RAISE EXCEPTION 'agent_configuration_draft_version_conflict' USING ERRCODE='23514';
  END IF;
  IF NEW.version=OLD.version THEN
   IF NEW.status<>'draft' OR NEW.save_sequence<>OLD.save_sequence+1 OR
      (to_jsonb(NEW)-ARRAY['step','updated_at','request_receipts','save_sequence']) IS DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['step','updated_at','request_receipts','save_sequence']) OR
      jsonb_array_length(NEW.request_receipts)<>least(32,jsonb_array_length(OLD.request_receipts)+1) OR
      coalesce((NEW.request_receipts->-1->>'version')::integer,-1)<>NEW.version OR
      coalesce(NEW.request_receipts->-1->>'requestId','') !~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' OR
      coalesce(NEW.request_receipts->-1->>'hash','') !~ '^[a-f0-9]{64}$' OR
      (SELECT coalesce(jsonb_agg(value ORDER BY ordinal),'[]'::jsonb) FROM jsonb_array_elements(OLD.request_receipts) WITH ORDINALITY e(value,ordinal)
        WHERE ordinal>greatest(0,jsonb_array_length(OLD.request_receipts)-31)) IS DISTINCT FROM (NEW.request_receipts-(-1)) THEN
    RAISE EXCEPTION 'agent_configuration_draft_version_conflict' USING ERRCODE='23514';
   END IF;
  ELSIF NEW.version<>OLD.version+1 THEN
   RAISE EXCEPTION 'agent_configuration_draft_version_conflict' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
