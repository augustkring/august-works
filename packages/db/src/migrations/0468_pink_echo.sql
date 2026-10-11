ALTER TABLE "customer_feedback_images" ADD COLUMN "storage_scope_id" text;--> statement-breakpoint
ALTER TABLE "feedback_image_deletions" ADD COLUMN "storage_scope_id" text;--> statement-breakpoint
ALTER TABLE "customer_feedback_images" ADD CONSTRAINT "customer_feedback_images_storage_scope_check" CHECK ("customer_feedback_images"."storage_scope_id" is null or "customer_feedback_images"."storage_scope_id" ~ '^[a-f0-9]{64}$');--> statement-breakpoint
ALTER TABLE "feedback_image_deletions" ADD CONSTRAINT "feedback_image_deletions_storage_scope_check" CHECK ("feedback_image_deletions"."storage_scope_id" is null or "feedback_image_deletions"."storage_scope_id" ~ '^[a-f0-9]{64}$');
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v9_preserve_feedback_image_erasure() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE deletion_id uuid;
BEGIN
  -- Parent trigger runs before either private access or image FK cascades.
  -- Only the existing account erasure owner can supply this operation link.
  SELECT o.id INTO deletion_id FROM account_deletion_operations o JOIN customer_feedback_access a ON a.user_id=o.user_id
    WHERE a.company_id=OLD.company_id AND a.feedback_id=OLD.id ORDER BY o.created_at LIMIT 1;
  INSERT INTO feedback_image_deletions (image_id,company_id,object_key,storage_scope_id,account_deletion_id,transport_settled_at)
    SELECT id,company_id,object_key,storage_scope_id,deletion_id,transport_settled_at FROM customer_feedback_images
      WHERE company_id=OLD.company_id AND feedback_id=OLD.id AND object_key IS NOT NULL AND status<>'deleted'
    ON CONFLICT (image_id) DO UPDATE SET
      account_deletion_id=coalesce(excluded.account_deletion_id,feedback_image_deletions.account_deletion_id),
      transport_settled_at=coalesce(feedback_image_deletions.transport_settled_at,excluded.transport_settled_at);
  RETURN OLD;
END $$;
--> statement-breakpoint
-- Existing unknown namespace locators remain unknown after migration. A current
-- configuration is never evidence of the provider that received an older PUT.
CREATE FUNCTION aw_v9_feedback_image_storage_scope_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_OP='INSERT' AND NEW.storage_scope_id IS NOT NULL THEN
    RAISE EXCEPTION 'Storage scope requires original allocation' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.object_key IS NOT NULL AND NEW.storage_scope_id IS DISTINCT FROM OLD.storage_scope_id THEN
      RAISE EXCEPTION 'Original image storage scope is immutable' USING ERRCODE='23514';
    END IF;
    IF OLD.object_key IS NULL AND NEW.object_key IS NOT NULL AND NEW.storage_scope_id IS NULL THEN
      RAISE EXCEPTION 'Protected allocation requires original storage scope' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.object_key IS NULL AND NEW.storage_scope_id IS NOT NULL THEN
    RAISE EXCEPTION 'Storage scope requires original allocation' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v9_feedback_image_storage_scope_guard BEFORE INSERT OR UPDATE ON customer_feedback_images
FOR EACH ROW EXECUTE FUNCTION aw_v9_feedback_image_storage_scope_guard();
--> statement-breakpoint
CREATE FUNCTION aw_v9_feedback_deletion_storage_scope_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_OP='INSERT' AND NOT EXISTS(SELECT 1 FROM customer_feedback_images i
    WHERE i.id=NEW.image_id AND i.company_id=NEW.company_id AND i.object_key=NEW.object_key
      AND i.storage_scope_id IS NOT DISTINCT FROM NEW.storage_scope_id)
    AND NOT EXISTS(SELECT 1 FROM feedback_image_deletions d
      WHERE d.image_id=NEW.image_id AND d.company_id=NEW.company_id AND d.object_key=NEW.object_key
        AND d.storage_scope_id IS NOT DISTINCT FROM NEW.storage_scope_id) THEN
    RAISE EXCEPTION 'Image deletion requires original storage allocation' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND NEW.storage_scope_id IS DISTINCT FROM OLD.storage_scope_id THEN
    RAISE EXCEPTION 'Original deletion storage scope is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.deleted_at IS NOT NULL AND NEW.storage_scope_id IS NULL THEN
    RAISE EXCEPTION 'Physical erasure requires known original storage scope' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v9_feedback_deletion_storage_scope_guard BEFORE INSERT OR UPDATE ON feedback_image_deletions
FOR EACH ROW EXECUTE FUNCTION aw_v9_feedback_deletion_storage_scope_guard();
--> statement-breakpoint
CREATE FUNCTION aw_v9_feedback_retention_storage_scope_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM customer_feedback_images i
    WHERE i.company_id=NEW.company_id AND i.id=ANY(NEW.object_image_ids) AND i.storage_scope_id IS NULL) THEN
    RAISE EXCEPTION 'Retention erasure requires known original storage scope' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND NEW.status='completed' AND OLD.status='pending' AND EXISTS(
    SELECT 1 FROM unnest(OLD.object_image_ids) n(id) LEFT JOIN feedback_image_deletions d
      ON d.company_id=OLD.company_id AND d.image_id=n.id WHERE d.id IS NULL OR d.storage_scope_id IS NULL) THEN
    RAISE EXCEPTION 'Retention completion requires original storage scope' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v9_feedback_retention_storage_scope_guard BEFORE INSERT OR UPDATE ON feedback_retention_erasures
FOR EACH ROW EXECUTE FUNCTION aw_v9_feedback_retention_storage_scope_guard();
