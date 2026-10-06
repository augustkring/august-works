CREATE INDEX "heartbeat_runs_company_running_capacity_idx" ON "heartbeat_runs" USING btree ("company_id","id") WHERE "heartbeat_runs"."status"='running';--> statement-breakpoint
-- Canonical heartbeat rows are the admitted-run capacity ledger. Saturation
-- leaves work queued; it never deletes knowledge or invents provider stopping.
CREATE FUNCTION aw_v7_free_core_running_capacity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE snapshot entitlement_snapshots; capacity numeric; occupied bigint;
BEGIN
 IF NEW.status<>'running' OR (TG_OP='UPDATE' AND OLD.status='running' AND OLD.company_id=NEW.company_id) THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM instance_settings WHERE singleton_key='default'
  AND experimental->>'free_core_commercial_v7'='true' AND experimental->>'billing_v6'='true'
  AND experimental->>'billing_entitlements_v6'='true' AND experimental->>'billing_usage_v6'='true') THEN RETURN NEW; END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'free_core_capacity_snapshot_isolation' USING ERRCODE='23514'; END IF;
 -- Cross-process serialization; each volatile SELECT gets a fresh committed view.
 PERFORM pg_advisory_xact_lock(740014,hashtext(NEW.company_id::text));
 SELECT * INTO snapshot FROM entitlement_snapshots WHERE company_id=NEW.company_id;
 IF snapshot.id IS NULL OR snapshot.catalog_version<>'aw-v7-free-core-2026-10-05' OR snapshot.valid_until<=now()
  OR snapshot.entitlements->>'platform.access'<>'true'
  OR NOT EXISTS(SELECT 1 FROM billing_account_companies c JOIN billing_accounts a ON a.id=c.billing_account_id JOIN companies co ON co.id=c.company_id WHERE c.company_id=NEW.company_id AND c.billing_account_id=snapshot.billing_account_id AND c.status='active' AND a.status='active' AND co.status='active')
  OR coalesce(snapshot.entitlements->>'execution.concurrent.max','') !~ '^[0-9]{1,40}$'
 THEN RAISE EXCEPTION 'free_core_current_capacity_snapshot_required' USING ERRCODE='23514'; END IF;
 capacity := (snapshot.entitlements->>'execution.concurrent.max')::numeric;
 SELECT count(*) INTO occupied FROM heartbeat_runs WHERE company_id=NEW.company_id AND status='running' AND id<>NEW.id;
 IF occupied>=capacity THEN RAISE EXCEPTION 'free_core_company_concurrency_limit' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v7_free_core_running_capacity BEFORE INSERT OR UPDATE ON heartbeat_runs FOR EACH ROW EXECUTE FUNCTION aw_v7_free_core_running_capacity();
