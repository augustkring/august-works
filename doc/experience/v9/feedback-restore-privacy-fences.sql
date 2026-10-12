-- Immutable erasure identities are separate from request receipts. A restored
-- database must import the latest independently authenticated operator ledger.
CREATE FUNCTION aw_v9_feedback_deletion_marker_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'Feedback erasure identity is immutable' USING ERRCODE='23514';
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v9_feedback_deletion_marker_immutable BEFORE UPDATE OR DELETE ON customer_feedback_deletion_markers
FOR EACH ROW EXECUTE FUNCTION aw_v9_feedback_deletion_marker_immutable();
--> statement-breakpoint
INSERT INTO customer_feedback_deletion_markers(subject_id,company_id,feedback_id,target_kind,erased_at)
SELECT feedback_id,company_id,feedback_id,'case',min(requested_at) FROM feedback_retention_erasures
WHERE target_kind='case' GROUP BY company_id,feedback_id ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO customer_feedback_deletion_markers(subject_id,company_id,feedback_id,target_kind,erased_at)
SELECT image_id,company_id,feedback_id,'image',min(requested_at) FROM feedback_retention_erasures
WHERE target_kind='image' GROUP BY company_id,feedback_id,image_id ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO customer_feedback_deletion_markers(subject_id,company_id,feedback_id,target_kind,erased_at)
SELECT n.id,e.company_id,e.feedback_id,'image',min(e.requested_at)
FROM feedback_retention_erasures e CROSS JOIN LATERAL unnest(e.object_image_ids) n(id)
GROUP BY e.company_id,e.feedback_id,n.id ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO customer_feedback_deletion_markers(subject_id,company_id,feedback_id,target_kind,erased_at)
SELECT id,company_id,feedback_id,'image',coalesce(deleted_at,clock_timestamp()) FROM customer_feedback_images
WHERE status IN ('deleting','deleted') ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE FUNCTION aw_v9_feedback_capture_deletion_marker() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE kind text; parent uuid;
BEGIN
  kind=CASE WHEN TG_TABLE_NAME='customer_feedback' THEN 'case' ELSE 'image' END;
  IF kind='case' THEN parent=OLD.id; ELSE parent=OLD.feedback_id; END IF;
  INSERT INTO customer_feedback_deletion_markers(subject_id,company_id,feedback_id,target_kind,erased_at)
  VALUES(OLD.id,OLD.company_id,parent,kind,clock_timestamp()) ON CONFLICT DO NOTHING;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v9_feedback_capture_deletion_marker BEFORE DELETE ON customer_feedback
FOR EACH ROW EXECUTE FUNCTION aw_v9_feedback_capture_deletion_marker();
--> statement-breakpoint
CREATE TRIGGER aw_v9_feedback_image_capture_deletion_marker BEFORE DELETE ON customer_feedback_images
FOR EACH ROW EXECUTE FUNCTION aw_v9_feedback_capture_deletion_marker();
--> statement-breakpoint
CREATE TRIGGER aw_v9_feedback_image_capture_deletion_transition AFTER UPDATE OF status ON customer_feedback_images
FOR EACH ROW WHEN (NEW.status IN ('deleting','deleted') AND OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION aw_v9_feedback_capture_deletion_marker();
--> statement-breakpoint
CREATE FUNCTION aw_v9_feedback_deletion_restore_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME='customer_feedback' THEN
    IF EXISTS(SELECT 1 FROM customer_feedback_deletion_markers WHERE subject_id=NEW.id) THEN
      RAISE EXCEPTION 'Erased feedback requires restore quarantine' USING ERRCODE='23514';
    END IF;
  ELSIF EXISTS(
    SELECT 1 FROM customer_feedback_deletion_markers
    WHERE subject_id=NEW.id OR (target_kind='case' AND subject_id=NEW.feedback_id)) THEN
    IF TG_OP='INSERT' THEN
      RAISE EXCEPTION 'Erased feedback image requires restore quarantine' USING ERRCODE='23514';
    ELSIF NEW.status NOT IN ('deleting','deleted') THEN
      RAISE EXCEPTION 'Erased feedback image requires restore quarantine' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v9_feedback_deletion_restore_guard BEFORE INSERT OR UPDATE ON customer_feedback
FOR EACH ROW EXECUTE FUNCTION aw_v9_feedback_deletion_restore_guard();
--> statement-breakpoint
CREATE TRIGGER aw_v9_feedback_image_deletion_restore_guard BEFORE INSERT OR UPDATE ON customer_feedback_images
FOR EACH ROW EXECUTE FUNCTION aw_v9_feedback_deletion_restore_guard();
