CREATE TABLE "customer_feedback_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"feedback_id" uuid NOT NULL,
	"request_key" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"status" text DEFAULT 'scanning' NOT NULL,
	"lease_token" uuid NOT NULL,
	"lease_expires_at" timestamp with time zone NOT NULL,
	"object_key" text,
	"media_type" text NOT NULL,
	"byte_size" integer,
	"sha256" text,
	"scanner_token" text,
	"scan_checked_at" timestamp with time zone,
	"transport_settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "customer_feedback_images_status_check" CHECK ("customer_feedback_images"."status" in ('scanning','storing','ready','deleting','deleted','failed')),
	CONSTRAINT "customer_feedback_images_media_check" CHECK ("customer_feedback_images"."media_type" in ('image/png','image/jpeg','image/webp')),
	CONSTRAINT "customer_feedback_images_size_check" CHECK ("customer_feedback_images"."byte_size" is null or "customer_feedback_images"."byte_size" between 1 and 10485760),
	CONSTRAINT "customer_feedback_images_ready_check" CHECK ("customer_feedback_images"."status" not in ('ready','deleting') or ("customer_feedback_images"."object_key" is not null and "customer_feedback_images"."byte_size" is not null and "customer_feedback_images"."sha256" ~ '^[a-f0-9]{64}$' and "customer_feedback_images"."scanner_token" ~ '^[a-f0-9]{64}$' and "customer_feedback_images"."scan_checked_at" is not null)),
	CONSTRAINT "customer_feedback_images_deleted_check" CHECK (("customer_feedback_images"."status" = 'deleted') = ("customer_feedback_images"."deleted_at" is not null)),
	CONSTRAINT "customer_feedback_images_company_key_check" CHECK ("customer_feedback_images"."object_key" is null or ("customer_feedback_images"."object_key" like "customer_feedback_images"."company_id"::text || '/feedback-images/%' and "customer_feedback_images"."object_key" not like '%..%'))
);
--> statement-breakpoint
CREATE TABLE "feedback_image_deletions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"image_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"account_deletion_id" uuid,
	"transport_settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "feedback_image_deletions_company_key_check" CHECK ("feedback_image_deletions"."object_key" like "feedback_image_deletions"."company_id"::text || '/feedback-images/%' and "feedback_image_deletions"."object_key" not like '%..%')
);
--> statement-breakpoint
CREATE TABLE "customer_feedback_retention" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"feedback_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"legal_hold" boolean DEFAULT false NOT NULL,
	"hold_release_at" timestamp with time zone,
	"hold_reason" text DEFAULT '' NOT NULL,
	"extension_until" timestamp with time zone,
	"extension_reason" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_feedback_retention_version_check" CHECK ("customer_feedback_retention"."version" > 0),
	CONSTRAINT "customer_feedback_retention_hold_check" CHECK (("customer_feedback_retention"."legal_hold" and length(trim("customer_feedback_retention"."hold_reason")) between 1 and 1000) or (not "customer_feedback_retention"."legal_hold" and "customer_feedback_retention"."hold_reason"='' and "customer_feedback_retention"."hold_release_at" is null)),
	CONSTRAINT "customer_feedback_retention_extension_check" CHECK (("customer_feedback_retention"."extension_until" is not null and length(trim("customer_feedback_retention"."extension_reason")) between 1 and 1000) or ("customer_feedback_retention"."extension_until" is null and "customer_feedback_retention"."extension_reason"=''))
);
--> statement-breakpoint
CREATE TABLE "customer_feedback_retention_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"feedback_id" uuid NOT NULL,
	"request_key" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"receipt" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_feedback" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customer_feedback_images" ADD CONSTRAINT "customer_feedback_images_company_id_feedback_id_customer_feedback_company_id_id_fk" FOREIGN KEY ("company_id","feedback_id") REFERENCES "public"."customer_feedback"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_feedback_retention" ADD CONSTRAINT "customer_feedback_retention_company_id_feedback_id_customer_feedback_company_id_id_fk" FOREIGN KEY ("company_id","feedback_id") REFERENCES "public"."customer_feedback"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_feedback_retention_changes" ADD CONSTRAINT "customer_feedback_retention_changes_company_id_feedback_id_customer_feedback_company_id_id_fk" FOREIGN KEY ("company_id","feedback_id") REFERENCES "public"."customer_feedback"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_feedback_images_request_idx" ON "customer_feedback_images" USING btree ("company_id","feedback_id","request_key");--> statement-breakpoint
CREATE INDEX "customer_feedback_images_owner_idx" ON "customer_feedback_images" USING btree ("company_id","feedback_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_image_deletions_image_idx" ON "feedback_image_deletions" USING btree ("image_id");--> statement-breakpoint
CREATE INDEX "feedback_image_deletions_pending_idx" ON "feedback_image_deletions" USING btree ("deleted_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_feedback_retention_owner_idx" ON "customer_feedback_retention" USING btree ("company_id","feedback_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_feedback_retention_changes_request_idx" ON "customer_feedback_retention_changes" USING btree ("company_id","feedback_id","request_key");
--> statement-breakpoint
-- Preserve the original immutable submission/version contract. A closure
-- timestamp comes from the native clock, never a request body. The sole author
-- removal exception requires the existing durable account erasure operation
-- and this case's private original ownership link.
CREATE OR REPLACE FUNCTION aw_v9_feedback_immutable_submission() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF OLD.submitted_by_user_id IS NOT NULL AND NEW.submitted_by_user_id IS NULL
    AND (to_jsonb(NEW)-'submitted_by_user_id'-'version') IS NOT DISTINCT FROM (to_jsonb(OLD)-'submitted_by_user_id'-'version')
    AND EXISTS(SELECT 1 FROM customer_feedback_access a JOIN account_deletion_operations o ON o.user_id=a.user_id
      WHERE a.company_id=OLD.company_id AND a.feedback_id=OLD.id AND a.user_id=OLD.submitted_by_user_id
        AND o.status IN ('requested','processing')) THEN
    IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Customer feedback version must advance once' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW)-'status'-'version'-'internal_state'-'closed_at') IS DISTINCT FROM
    (to_jsonb(OLD)-'status'-'version'-'internal_state'-'closed_at') THEN
    RAISE EXCEPTION 'Customer feedback submission is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Customer feedback version must advance once' USING ERRCODE='23514'; END IF;
  IF NEW.status IN ('CLOSED','RESOLVED') THEN
    NEW.closed_at=coalesce(OLD.closed_at,clock_timestamp());
  ELSE NEW.closed_at=NULL;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- Native feedback image reservations. Installed by the generated migration.
CREATE FUNCTION aw_v9_feedback_image_reservation_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE current_count integer;
BEGIN
  IF TG_OP='DELETE' THEN
    IF EXISTS(SELECT 1 FROM customer_feedback WHERE company_id=OLD.company_id AND id=OLD.feedback_id) THEN
      RAISE EXCEPTION 'Image erasure requires its original owner' USING ERRCODE='23514';
    END IF;
    RETURN OLD;
  END IF;
  PERFORM id FROM customer_feedback WHERE company_id=NEW.company_id AND id=NEW.feedback_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Original feedback owner is unavailable' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' AND (NEW.status<>'scanning' OR NEW.object_key IS NOT NULL OR NEW.transport_settled_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Image allocation requires its original native reservation' USING ERRCODE='23514';
  END IF;
  IF NEW.object_key IS NOT NULL AND strpos(NEW.object_key,
      NEW.company_id::text || '/feedback-images/' || NEW.feedback_id::text || '/' || NEW.id::text || '/')<>1 THEN
    RAISE EXCEPTION 'Protected image path requires its exact original owner' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.object_key IS NULL AND NEW.object_key IS NOT NULL AND (OLD.status<>'scanning' OR NEW.status<>'storing') THEN
      RAISE EXCEPTION 'Image allocation requires its original native reservation' USING ERRCODE='23514';
    END IF;
    IF (NEW.id,NEW.company_id,NEW.feedback_id,NEW.request_key,NEW.request_hash,NEW.media_type,NEW.created_at)
      IS DISTINCT FROM (OLD.id,OLD.company_id,OLD.feedback_id,OLD.request_key,OLD.request_hash,OLD.media_type,OLD.created_at) THEN
      RAISE EXCEPTION 'Feedback image ownership and request are immutable' USING ERRCODE='23514';
    END IF;
    IF OLD.object_key IS NOT NULL AND (NEW.object_key,NEW.sha256,NEW.byte_size,NEW.scanner_token,NEW.scan_checked_at)
      IS DISTINCT FROM (OLD.object_key,OLD.sha256,OLD.byte_size,OLD.scanner_token,OLD.scan_checked_at) THEN
      RAISE EXCEPTION 'Allocated image content is immutable' USING ERRCODE='23514';
    END IF;
    IF OLD.transport_settled_at IS NOT NULL AND NEW.transport_settled_at IS DISTINCT FROM OLD.transport_settled_at THEN
      RAISE EXCEPTION 'Original image transport receipt is immutable' USING ERRCODE='23514';
    END IF;
    IF NEW.status<>OLD.status AND NOT (
      (OLD.status='scanning' AND NEW.status IN ('storing','failed')) OR
      (OLD.status IN ('scanning','failed') AND NEW.status='deleted' AND OLD.object_key IS NULL AND NEW.object_key IS NULL) OR
      (OLD.status='failed' AND NEW.status='scanning' AND OLD.object_key IS NULL) OR
      (OLD.status='storing' AND NEW.status IN ('ready','deleting')) OR
      (OLD.status='ready' AND NEW.status='deleting') OR
      (OLD.status='deleting' AND NEW.status='deleted')
    ) THEN RAISE EXCEPTION 'Feedback image transition requires its original owner' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW.status='deleted' THEN
    IF TG_OP='UPDATE' AND OLD.status='deleted' THEN
      IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
        RAISE EXCEPTION 'Original image erasure receipt is immutable' USING ERRCODE='23514';
      END IF;
    ELSE NEW.deleted_at=clock_timestamp(); END IF;
  END IF;
  IF NEW.status IN ('scanning','storing','ready','deleting') THEN
    IF ((TG_OP='INSERT') OR NEW.status='deleting') AND EXISTS(
      SELECT 1 FROM customer_feedback_retention WHERE company_id=NEW.company_id AND feedback_id=NEW.feedback_id
        AND legal_hold AND (hold_release_at IS NULL OR hold_release_at>clock_timestamp())) THEN
      RAISE EXCEPTION 'Current feedback retention hold requires its original operator' USING ERRCODE='23514';
    END IF;
    SELECT count(*) INTO current_count FROM customer_feedback_images
      WHERE company_id=NEW.company_id AND feedback_id=NEW.feedback_id
        AND id<>NEW.id AND status IN ('scanning','storing','ready','deleting');
    IF current_count>=3 THEN RAISE EXCEPTION 'Feedback allows at most three images' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v9_feedback_image_reservation_guard BEFORE INSERT OR UPDATE OR DELETE ON customer_feedback_images
FOR EACH ROW EXECUTE FUNCTION aw_v9_feedback_image_reservation_guard();
--> statement-breakpoint
CREATE FUNCTION aw_v9_preserve_feedback_image_erasure() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE deletion_id uuid;
BEGIN
  -- Parent trigger runs before either private access or image FK cascades.
  -- Only the existing account erasure owner can supply this operation link.
  SELECT o.id INTO deletion_id FROM account_deletion_operations o JOIN customer_feedback_access a ON a.user_id=o.user_id
    WHERE a.company_id=OLD.company_id AND a.feedback_id=OLD.id ORDER BY o.created_at LIMIT 1;
  INSERT INTO feedback_image_deletions (image_id,company_id,object_key,account_deletion_id,transport_settled_at)
    SELECT id,company_id,object_key,deletion_id,transport_settled_at FROM customer_feedback_images
      WHERE company_id=OLD.company_id AND feedback_id=OLD.id AND object_key IS NOT NULL AND status<>'deleted'
    ON CONFLICT (image_id) DO UPDATE SET
      account_deletion_id=coalesce(excluded.account_deletion_id,feedback_image_deletions.account_deletion_id),
      transport_settled_at=coalesce(feedback_image_deletions.transport_settled_at,excluded.transport_settled_at);
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v9_preserve_feedback_image_erasure BEFORE DELETE ON customer_feedback
FOR EACH ROW EXECUTE FUNCTION aw_v9_preserve_feedback_image_erasure();
--> statement-breakpoint
CREATE FUNCTION aw_v9_guard_feedback_image_erasure_receipt() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.deleted_at IS NULL THEN RAISE EXCEPTION 'Protected image erasure is not confirmed' USING ERRCODE='23514'; END IF;
    RETURN OLD;
  END IF;
  IF (NEW.id,NEW.image_id,NEW.company_id,NEW.object_key,NEW.created_at)
    IS DISTINCT FROM (OLD.id,OLD.image_id,OLD.company_id,OLD.object_key,OLD.created_at)
    OR (OLD.account_deletion_id IS NOT NULL AND NEW.account_deletion_id IS DISTINCT FROM OLD.account_deletion_id)
    OR (OLD.transport_settled_at IS NOT NULL AND NEW.transport_settled_at IS DISTINCT FROM OLD.transport_settled_at)
    OR (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS DISTINCT FROM OLD.deleted_at) THEN
    RAISE EXCEPTION 'Original image erasure receipt is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v9_guard_feedback_image_erasure_receipt BEFORE UPDATE OR DELETE ON feedback_image_deletions
FOR EACH ROW EXECUTE FUNCTION aw_v9_guard_feedback_image_erasure_receipt();
--> statement-breakpoint
CREATE FUNCTION aw_v9_feedback_hold_preserves_content() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM customer_feedback_retention WHERE company_id=OLD.company_id AND feedback_id=OLD.id
    AND legal_hold AND (hold_release_at IS NULL OR hold_release_at>clock_timestamp())) THEN
    RAISE EXCEPTION 'Current feedback retention hold requires its original operator' USING ERRCODE='23514';
  END IF;
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v9_feedback_hold_preserves_content BEFORE DELETE ON customer_feedback
FOR EACH ROW EXECUTE FUNCTION aw_v9_feedback_hold_preserves_content();
--> statement-breakpoint
CREATE FUNCTION aw_v9_feedback_retention_owner_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF EXISTS(SELECT 1 FROM customer_feedback WHERE company_id=OLD.company_id AND id=OLD.feedback_id) THEN
      RAISE EXCEPTION 'Retention controls require their original operator' USING ERRCODE='23514';
    END IF;
    RETURN OLD;
  END IF;
  PERFORM id FROM customer_feedback WHERE company_id=NEW.company_id AND id=NEW.feedback_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Original feedback owner is unavailable' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND ((NEW.id,NEW.company_id,NEW.feedback_id) IS DISTINCT FROM (OLD.id,OLD.company_id,OLD.feedback_id)
    OR NEW.version<>OLD.version+1) THEN
    RAISE EXCEPTION 'Retention controls require their original version' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v9_feedback_retention_owner_guard BEFORE INSERT OR UPDATE OR DELETE ON customer_feedback_retention
FOR EACH ROW EXECUTE FUNCTION aw_v9_feedback_retention_owner_guard();
--> statement-breakpoint
CREATE FUNCTION aw_v9_feedback_retention_receipt_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_OP='UPDATE' OR (TG_OP='DELETE' AND EXISTS(SELECT 1 FROM customer_feedback WHERE company_id=OLD.company_id AND id=OLD.feedback_id)) THEN
    RAISE EXCEPTION 'Original retention receipt is immutable' USING ERRCODE='23514';
  END IF;
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v9_feedback_retention_receipt_guard BEFORE UPDATE OR DELETE ON customer_feedback_retention_changes
FOR EACH ROW EXECUTE FUNCTION aw_v9_feedback_retention_receipt_guard();
