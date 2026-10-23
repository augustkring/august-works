-- The original FK retains an attachment when its comment is hard-deleted.
-- Clear the old body capture before ON DELETE SET NULL changes that binding,
-- including deletes through queue, Agent and company owners. Unknown stays
-- unknown; the original binding trigger latches invalidation and forbids rebind.
CREATE FUNCTION public.aw_invalidate_attachment_comment_payload() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE public.issue_attachments SET payload_source_snapshot=NULL
    WHERE company_id=OLD.company_id AND issue_comment_id=OLD.id
      AND payload_source_snapshot IS NOT NULL;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER issue_comments_invalidate_attachment_payload BEFORE DELETE ON public.issue_comments
FOR EACH ROW EXECUTE FUNCTION public.aw_invalidate_attachment_comment_payload();

--> statement-breakpoint
-- The existing Learning erasure guard rewrites revision bytes before binding.
-- Preserve its fixed marker and immutable identity while clearing only the
-- erased body's capture. Neither reviewed content nor other fields may change.
CREATE OR REPLACE FUNCTION aw_learning_guard_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF aw_learning_asset_erased(NEW.company_id,'document_revision',NEW.id) THEN
   NEW.body='';NEW.title='Erased learning evidence';NEW.change_summary=NULL;NEW.payload_source_snapshot=NULL;
 END IF;
 RETURN NEW;
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v5_playbook_revision_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND aw_learning_asset_erased(OLD.company_id,'document_revision',OLD.id) THEN
   IF NEW.body='' AND NEW.title='Erased learning evidence' AND NEW.change_summary IS NULL
     AND NEW.payload_source_snapshot IS NULL
     AND (to_jsonb(NEW)-ARRAY['body','title','change_summary','payload_source_snapshot'])=(to_jsonb(OLD)-ARRAY['body','title','change_summary','payload_source_snapshot']) THEN
     RETURN NEW;
   END IF;
   RAISE EXCEPTION USING ERRCODE='23514', CONSTRAINT='aw_v5_playbook_revision_immutable', MESSAGE='Playbook revisions are immutable';
 END IF;
 IF EXISTS(SELECT 1 FROM documents WHERE id=OLD.document_id) AND EXISTS(SELECT 1 FROM playbook_documents WHERE document_id=OLD.document_id) AND (
   TG_OP='DELETE' OR NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.document_id IS DISTINCT FROM OLD.document_id OR NEW.body IS DISTINCT FROM OLD.body OR NEW.title IS DISTINCT FROM OLD.title OR NEW.revision_number IS DISTINCT FROM OLD.revision_number OR NEW.change_summary IS DISTINCT FROM OLD.change_summary
 ) THEN
   RAISE EXCEPTION USING ERRCODE='23514', CONSTRAINT='aw_v5_playbook_revision_immutable', MESSAGE='Playbook revisions are immutable';
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v7_verified_output_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE doc uuid; company uuid;
BEGIN

 -- Privacy erasure is not a replacement verified output. Actual Source loss
 -- permits only the original fixed marker, preserving all receipt identities.
 IF TG_OP='UPDATE' THEN
   IF TG_TABLE_NAME='document_revisions' THEN
     IF aw_learning_asset_erased(OLD.company_id,'document_revision',OLD.id)
       AND NEW.body='' AND NEW.title='Erased learning evidence' AND NEW.change_summary IS NULL
       AND NEW.payload_source_snapshot IS NULL
     AND (to_jsonb(NEW)-ARRAY['body','title','change_summary','payload_source_snapshot'])=(to_jsonb(OLD)-ARRAY['body','title','change_summary','payload_source_snapshot']) THEN RETURN NEW; END IF;
   ELSIF TG_TABLE_NAME='documents' THEN
     IF OLD.latest_revision_id IS NOT NULL AND aw_learning_asset_erased(OLD.company_id,'document_revision',OLD.latest_revision_id)
       AND NEW.latest_body='' AND NEW.title='Erased learning evidence'
       AND (to_jsonb(NEW)-ARRAY['latest_body','title','updated_at'])=(to_jsonb(OLD)-ARRAY['latest_body','title','updated_at']) THEN RETURN NEW; END IF;
   END IF;
 END IF;
 IF TG_TABLE_NAME='documents' THEN
  IF TG_OP='UPDATE' AND (NEW.latest_body,NEW.latest_revision_id) IS NOT DISTINCT FROM (OLD.latest_body,OLD.latest_revision_id) THEN RETURN NEW; END IF;
  doc=OLD.id; company=OLD.company_id;
 ELSE
  doc=OLD.document_id; company=OLD.company_id;
 END IF;
 IF EXISTS(SELECT 1 FROM verification_runs v JOIN orchestration_plans p ON p.company_id=v.company_id AND p.id=v.plan_id WHERE v.company_id=company AND v.result='pass' AND v.erased_at IS NULL AND p.erased_at IS NULL AND p.status NOT IN('completed','cancelled','failed')
   AND v.input_artifact_refs @> jsonb_build_array(jsonb_build_object('type','task_document','sourceId',doc::text)))
 THEN RAISE EXCEPTION 'verified_output_requires_new_plan' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END; $$;
