-- Allow published Role Pack rows to be deleted only as part of the current
-- canonical company-content erasure transaction. Ordinary edits/deletes remain
-- subject to the original immutable published-version guards.
CREATE OR REPLACE FUNCTION aw_v5_company_purge_owner(company uuid) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS(
    SELECT 1 FROM companies c
    JOIN company_deletion_operations operation ON operation.company_id=c.id
    WHERE c.id=company
      AND c.status='archived'
      AND c.pause_reason='company_deleted'
      AND c.content_erasure_transaction_id=pg_current_xact_id()::text
      AND operation.stage='purge'
      AND operation.status='processing'
      AND operation.evidence->>'runtimesErasedAt' IS NOT NULL
  )
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v5_guard_role_pack_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' AND aw_v5_company_purge_owner(OLD.company_id) THEN RETURN OLD; END IF;
 IF TG_OP='UPDATE' AND aw_learning_asset_erased(OLD.company_id,'role_pack_version',OLD.id) AND NEW.summary=''
 AND (to_jsonb(NEW)-'summary')=(to_jsonb(OLD)-'summary') THEN RETURN NEW; END IF;
 IF OLD.state='published' AND EXISTS(SELECT 1 FROM role_packs WHERE id=OLD.role_pack_id) THEN
   RAISE EXCEPTION 'Published Role Pack versions are immutable'
     USING ERRCODE='23514',CONSTRAINT='aw_v5_published_role_pack_immutable';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v5_guard_role_pack_items() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id uuid; parent_state text;
BEGIN
 target_id:=CASE WHEN TG_OP='DELETE' THEN OLD.version_id ELSE NEW.version_id END;
 IF TG_OP='DELETE' AND aw_v5_company_purge_owner(OLD.company_id) THEN RETURN OLD; END IF;
 IF TG_OP='DELETE' AND aw_learning_asset_erased(OLD.company_id,'role_pack_version',target_id) THEN RETURN OLD; END IF;
 IF TG_OP<>'DELETE' AND NOT aw_learning_asset_current(NEW.company_id,'role_pack_version',target_id) THEN
   RAISE EXCEPTION 'Role Pack Learning source changed' USING ERRCODE='23514';
 END IF;
 SELECT state INTO parent_state FROM role_pack_versions WHERE id=target_id FOR SHARE;
 IF parent_state='published' THEN
   RAISE EXCEPTION 'Published Role Pack items are immutable'
     USING ERRCODE='23514',CONSTRAINT='aw_v5_published_role_pack_immutable';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF TG_OP='UPDATE' AND OLD.version_id<>NEW.version_id THEN
   RAISE EXCEPTION 'Role Pack item version association is immutable'
     USING ERRCODE='23514',CONSTRAINT='aw_v5_published_role_pack_immutable';
 END IF;
 RETURN NEW;
END $$;
