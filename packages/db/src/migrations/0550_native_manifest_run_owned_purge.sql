-- Preserve immutable execution-manifest identity during ordinary operation.
-- Company purge may remove the manifest only as the original heartbeat Run's
-- FK cascade, after the exact source payload is erased and the company has a
-- same-transaction canonical content-erasure tombstone.
CREATE OR REPLACE FUNCTION aw_v5_execution_manifest_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.manifest='{"payloadDeleted":true}'::jsonb
   AND (to_jsonb(NEW)-'manifest')=(to_jsonb(OLD)-'manifest')
   AND aw_execution_manifest_payload_erased(NEW.company_id,NEW.run_id,NEW.context_manifest_id) THEN
   RETURN NEW;
 END IF;
 IF TG_OP='DELETE'
   AND pg_trigger_depth()>1
   AND EXISTS (SELECT 1 FROM companies c WHERE c.id=OLD.company_id AND c.status='archived'
     AND c.pause_reason='company_deleted'
     AND c.content_erasure_transaction_id=pg_current_xact_id()::text)
   AND EXISTS (SELECT 1 FROM context_manifests c WHERE c.company_id=OLD.company_id
     AND c.id=OLD.context_manifest_id AND c.run_id=OLD.run_id)
   AND aw_execution_manifest_payload_erased(OLD.company_id,OLD.run_id,OLD.context_manifest_id) THEN
   RETURN OLD;
 END IF;
 RAISE EXCEPTION USING ERRCODE='23514', CONSTRAINT='aw_v5_execution_manifest_immutable', MESSAGE='Execution manifests are immutable';
END $$;
