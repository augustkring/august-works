-- Repeat erasure immediately from the native Source predicate, including the
-- interval before the existing asynchronous Learning/Memory worker arrives.
CREATE OR REPLACE FUNCTION aw_learning_guard_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF aw_learning_asset_erased(NEW.company_id,'document_revision',NEW.id) THEN
   NEW.body='';NEW.title='Erased learning evidence';NEW.change_summary=NULL;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_learning_guard_document_cache() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.latest_revision_id IS NOT NULL AND aw_learning_asset_erased(NEW.company_id,'document_revision',NEW.latest_revision_id) THEN
   NEW.latest_body='';NEW.title='Erased learning evidence';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
-- Original reviewed Playbook revisions remain immutable. C7 only replaces
-- an actually erased native Learning asset with its fixed privacy marker.
CREATE OR REPLACE FUNCTION aw_v5_playbook_revision_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND aw_learning_asset_erased(OLD.company_id,'document_revision',OLD.id) THEN
   IF NEW.body='' AND NEW.title='Erased learning evidence' AND NEW.change_summary IS NULL
     AND (to_jsonb(NEW)-ARRAY['body','title','change_summary'])=(to_jsonb(OLD)-ARRAY['body','title','change_summary']) THEN
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
       AND (to_jsonb(NEW)-ARRAY['body','title','change_summary'])=(to_jsonb(OLD)-ARRAY['body','title','change_summary']) THEN RETURN NEW; END IF;
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
--> statement-breakpoint
-- Existing native C7 markers are authoritative; populated hosted backfill
-- qualification remains a separate acceptance check.
UPDATE document_revisions SET body='',title='Erased learning evidence',change_summary=NULL
 WHERE aw_learning_asset_erased(company_id,'document_revision',id)
 AND EXISTS(SELECT 1 FROM playbook_documents p WHERE p.company_id=document_revisions.company_id AND p.document_id=document_revisions.document_id);

--> statement-breakpoint
UPDATE documents SET latest_body='',title='Erased learning evidence',updated_at=now()
 WHERE latest_revision_id IS NOT NULL AND aw_learning_asset_erased(company_id,'document_revision',latest_revision_id)
 AND EXISTS(SELECT 1 FROM playbook_documents p WHERE p.company_id=documents.company_id AND p.document_id=documents.id);
--> statement-breakpoint
UPDATE playbook_documents SET status='in_review',approved_revision_id=NULL,updated_at=now()
 WHERE approved_revision_id IS NOT NULL AND aw_learning_asset_erased(company_id,'document_revision',approved_revision_id);
