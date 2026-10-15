CREATE TABLE "feedback_retention_erasures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"feedback_id" uuid NOT NULL,
	"request_key" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"operator_hash" text NOT NULL,
	"review_hash" text NOT NULL,
	"policy_hash" text NOT NULL,
	"case_version" integer NOT NULL,
	"retention_version" integer NOT NULL,
	"target_kind" text NOT NULL,
	"image_id" uuid,
	"object_image_ids" uuid[] NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "feedback_retention_erasures_scope_check" CHECK (("feedback_retention_erasures"."target_kind"='case' and "feedback_retention_erasures"."image_id" is null) or ("feedback_retention_erasures"."target_kind"='image' and "feedback_retention_erasures"."image_id" is not null)),
	CONSTRAINT "feedback_retention_erasures_version_check" CHECK ("feedback_retention_erasures"."case_version">=0 and "feedback_retention_erasures"."retention_version">=0),
	CONSTRAINT "feedback_retention_erasures_digest_check" CHECK ("feedback_retention_erasures"."request_hash" ~ '^[a-f0-9]{64}$' and "feedback_retention_erasures"."operator_hash" ~ '^[a-f0-9]{64}$' and "feedback_retention_erasures"."review_hash" ~ '^[a-f0-9]{64}$' and "feedback_retention_erasures"."policy_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "feedback_retention_erasures_objects_check" CHECK (cardinality("feedback_retention_erasures"."object_image_ids") between 0 and 3 and array_position("feedback_retention_erasures"."object_image_ids",null) is null),
	CONSTRAINT "feedback_retention_erasures_state_check" CHECK (("feedback_retention_erasures"."status"='pending' and "feedback_retention_erasures"."completed_at" is null) or ("feedback_retention_erasures"."status"='completed' and "feedback_retention_erasures"."completed_at" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_retention_erasures_request_idx" ON "feedback_retention_erasures" USING btree ("company_id","feedback_id","request_key");--> statement-breakpoint
CREATE INDEX "feedback_retention_erasures_pending_idx" ON "feedback_retention_erasures" USING btree ("company_id","status");
--> statement-breakpoint
-- Original reviewed erasure receipts survive subject deletion. This ledger
-- prevents ordinary re-insertion while it is retained; restoring an older
-- backup that lost the ledger still requires separate restore quarantine.
CREATE FUNCTION aw_v9_feedback_retention_erasure_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE native_version integer; controls_version integer;
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Retention erasure receipt requires its original policy owner' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' THEN
    SELECT version INTO native_version FROM customer_feedback WHERE company_id=NEW.company_id AND id=NEW.feedback_id FOR UPDATE;
    SELECT version INTO controls_version FROM customer_feedback_retention WHERE company_id=NEW.company_id AND feedback_id=NEW.feedback_id FOR UPDATE;
    IF native_version IS NULL OR native_version<>NEW.case_version OR coalesce(controls_version,0)<>NEW.retention_version THEN
      RAISE EXCEPTION 'Retention erasure source changed' USING ERRCODE='23514';
    END IF;
    IF NEW.status<>'pending' OR NEW.completed_at IS NOT NULL THEN
      RAISE EXCEPTION 'Retention erasure requires original pending admission' USING ERRCODE='23514';
    END IF;
    IF EXISTS(SELECT 1 FROM customer_feedback_retention WHERE company_id=NEW.company_id AND feedback_id=NEW.feedback_id
      AND legal_hold AND (hold_release_at IS NULL OR hold_release_at>clock_timestamp())) THEN
      RAISE EXCEPTION 'Current feedback retention hold requires its original operator' USING ERRCODE='23514';
    END IF;
    IF cardinality(NEW.object_image_ids)<>(SELECT count(DISTINCT id) FROM unnest(NEW.object_image_ids) id)
      OR EXISTS(SELECT 1 FROM unnest(NEW.object_image_ids) n(id) WHERE NOT EXISTS(
        SELECT 1 FROM customer_feedback_images i WHERE i.id=n.id AND i.company_id=NEW.company_id AND i.feedback_id=NEW.feedback_id
          AND i.object_key IS NOT NULL AND i.transport_settled_at IS NOT NULL AND i.status IN ('storing','ready','deleting'))) THEN
      RAISE EXCEPTION 'Retention erasure requires exact settled original objects' USING ERRCODE='23514';
    END IF;
    IF NEW.target_kind='case' AND EXISTS(SELECT 1 FROM customer_feedback_images i
      WHERE i.company_id=NEW.company_id AND i.feedback_id=NEW.feedback_id AND i.object_key IS NOT NULL AND i.status<>'deleted'
        AND NOT (i.id=ANY(NEW.object_image_ids))) THEN
      RAISE EXCEPTION 'Case erasure must preserve every original object' USING ERRCODE='23514';
    END IF;
    IF NEW.target_kind='image' AND (NOT EXISTS(SELECT 1 FROM customer_feedback_images i
      WHERE i.company_id=NEW.company_id AND i.feedback_id=NEW.feedback_id AND i.id=NEW.image_id AND i.status<>'deleted')
      OR EXISTS(SELECT 1 FROM unnest(NEW.object_image_ids) n(id) WHERE n.id<>NEW.image_id)
      OR EXISTS(SELECT 1 FROM customer_feedback_images i WHERE i.id=NEW.image_id AND i.object_key IS NOT NULL
        AND NOT (i.id=ANY(NEW.object_image_ids)))) THEN
      RAISE EXCEPTION 'Image erasure requires its original image' USING ERRCODE='23514';
    END IF;
    NEW.requested_at=clock_timestamp();
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW)-'status'-'completed_at') IS DISTINCT FROM (to_jsonb(OLD)-'status'-'completed_at') THEN
    RAISE EXCEPTION 'Original retention erasure request is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.status='completed' AND (NEW.status,NEW.completed_at) IS DISTINCT FROM (OLD.status,OLD.completed_at) THEN
    RAISE EXCEPTION 'Original retention erasure completion is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.status='completed' AND OLD.status='pending' THEN
    IF EXISTS(SELECT 1 FROM unnest(OLD.object_image_ids) n(id) LEFT JOIN feedback_image_deletions d
      ON d.company_id=OLD.company_id AND d.image_id=n.id WHERE d.id IS NULL OR d.deleted_at IS NULL OR d.transport_settled_at IS NULL)
      OR (OLD.target_kind='case' AND EXISTS(SELECT 1 FROM customer_feedback WHERE company_id=OLD.company_id AND id=OLD.feedback_id))
      OR (OLD.target_kind='image' AND EXISTS(SELECT 1 FROM customer_feedback_images
        WHERE company_id=OLD.company_id AND id=OLD.image_id AND status<>'deleted')) THEN
      RAISE EXCEPTION 'Retention erasure is not physically confirmed' USING ERRCODE='23514';
    END IF;
    NEW.completed_at=clock_timestamp();
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v9_feedback_retention_erasure_guard BEFORE INSERT OR UPDATE OR DELETE ON feedback_retention_erasures
FOR EACH ROW EXECUTE FUNCTION aw_v9_feedback_retention_erasure_guard();
--> statement-breakpoint
CREATE FUNCTION aw_v9_feedback_erasure_restore_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME='customer_feedback' THEN
    IF EXISTS(SELECT 1 FROM feedback_retention_erasures WHERE company_id=NEW.company_id AND feedback_id=NEW.id AND target_kind='case') THEN
      RAISE EXCEPTION 'Erased feedback requires restore quarantine' USING ERRCODE='23514';
    END IF;
  ELSE
    IF EXISTS(SELECT 1 FROM feedback_retention_erasures WHERE company_id=NEW.company_id
      AND (image_id=NEW.id OR NEW.id=ANY(object_image_ids) OR (target_kind='case' AND feedback_id=NEW.feedback_id))) THEN
      RAISE EXCEPTION 'Erased feedback image requires restore quarantine' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v9_feedback_erasure_restore_guard BEFORE INSERT ON customer_feedback
FOR EACH ROW EXECUTE FUNCTION aw_v9_feedback_erasure_restore_guard();
--> statement-breakpoint
CREATE TRIGGER aw_v9_feedback_image_erasure_restore_guard BEFORE INSERT ON customer_feedback_images
FOR EACH ROW EXECUTE FUNCTION aw_v9_feedback_erasure_restore_guard();
