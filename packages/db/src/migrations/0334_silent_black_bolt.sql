
ALTER TABLE "document_revisions" ADD CONSTRAINT "document_revisions_company_id_uq" UNIQUE("company_id","id");--> statement-breakpointALTER TABLE "playbook_change_proposals" ADD COLUMN "base_draft_revision_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "playbook_skill_links" ADD CONSTRAINT "playbook_skill_links_company_id_playbook_revision_id_document_revisions_company_id_id_fk" FOREIGN KEY ("company_id","playbook_revision_id") REFERENCES "public"."document_revisions"("company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION aw_v5_playbook_revision_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM documents WHERE id = OLD.document_id) AND EXISTS (SELECT 1 FROM playbook_documents WHERE document_id = OLD.document_id) AND (
    TG_OP = 'DELETE' OR NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.document_id IS DISTINCT FROM OLD.document_id OR NEW.body IS DISTINCT FROM OLD.body OR NEW.title IS DISTINCT FROM OLD.title OR NEW.revision_number IS DISTINCT FROM OLD.revision_number OR NEW.change_summary IS DISTINCT FROM OLD.change_summary
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'aw_v5_playbook_revision_immutable', MESSAGE = 'Playbook revisions are immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v5_playbook_revision_immutable BEFORE UPDATE OR DELETE ON document_revisions FOR EACH ROW EXECUTE FUNCTION aw_v5_playbook_revision_immutable();
