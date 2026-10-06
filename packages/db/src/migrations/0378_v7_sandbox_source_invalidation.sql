-- Qualification belongs to the exact native model/resource/host placement.
-- Metadata changes fence bindings and policies even with V7 flags disabled.
CREATE OR REPLACE FUNCTION aw_v7_sandbox_cell_invalidate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.generation,NEW.active_image_digest,NEW.desired_image_digest,NEW.model_provider,NEW.model_id,NEW.model_secret_ref,NEW.model_secret_version,NEW.provider_binding_id,NEW.capacity_profile,NEW.runtime_provider,NEW.isolation_mode,NEW.runtime_host_id,NEW.gateway_secret_ref,NEW.deleted_at)
 IS DISTINCT FROM
 (OLD.generation,OLD.active_image_digest,OLD.desired_image_digest,OLD.model_provider,OLD.model_id,OLD.model_secret_ref,OLD.model_secret_version,OLD.provider_binding_id,OLD.capacity_profile,OLD.runtime_provider,OLD.isolation_mode,OLD.runtime_host_id,OLD.gateway_secret_ref,OLD.deleted_at) THEN
  UPDATE runtime_sandbox_bindings SET status='quarantined',version=version+1,updated_at=now() WHERE company_id=NEW.company_id AND runtime_cell_id=NEW.id AND status NOT IN ('deleted','quarantined');
  UPDATE runtime_policy_snapshots SET status='revoked' WHERE company_id=NEW.company_id AND runtime_cell_id=NEW.id AND status IN ('draft','qualified');
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION aw_v7_sandbox_host_invalidate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.credential_version,NEW.public_key_pem,NEW.credential_revoked_at,NEW.fenced_at,NEW.retired_at)
 IS DISTINCT FROM (OLD.credential_version,OLD.public_key_pem,OLD.credential_revoked_at,OLD.fenced_at,OLD.retired_at)
 OR (NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('DEGRADED','UNREACHABLE','RETIRED','FAILED')) THEN
  UPDATE runtime_sandbox_bindings b SET status='quarantined',version=b.version+1,updated_at=now()
   WHERE b.status NOT IN ('deleted','quarantined') AND EXISTS(SELECT 1 FROM runtime_cells c WHERE c.company_id=b.company_id AND c.id=b.runtime_cell_id AND c.runtime_host_id=NEW.id);
  UPDATE runtime_policy_snapshots p SET status='revoked' WHERE p.status IN ('draft','qualified') AND EXISTS(SELECT 1 FROM runtime_cells c WHERE c.company_id=p.company_id AND c.id=p.runtime_cell_id AND c.runtime_host_id=NEW.id);
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v7_sandbox_host_invalidate AFTER UPDATE ON runtime_hosts FOR EACH ROW EXECUTE FUNCTION aw_v7_sandbox_host_invalidate();
