CREATE OR REPLACE FUNCTION "aw_guard_workflow_revision_delete"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  workflow_draft_revision_id uuid;
  workflow_published_revision_id uuid;
BEGIN
  SELECT "draft_revision_id", "published_revision_id"
  INTO workflow_draft_revision_id, workflow_published_revision_id
  FROM "workflows"
  WHERE "id" = OLD."workflow_id"
    AND "company_id" = OLD."company_id";

  -- If the parent workflow is already gone, this delete is part of the
  -- explicit workflow/company cascade and history may follow its owner.
  IF NOT FOUND THEN
    RETURN OLD;
  END IF;

  IF workflow_draft_revision_id = OLD."id"
     OR workflow_published_revision_id = OLD."id" THEN
    RAISE EXCEPTION 'active workflow revision cannot be deleted'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."state" IN ('published', 'superseded') THEN
    RAISE EXCEPTION 'published workflow history cannot be deleted directly'
      USING ERRCODE = '23514';
  END IF;

  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "workflow_revisions_delete_guard"
BEFORE DELETE ON "workflow_revisions"
FOR EACH ROW
EXECUTE FUNCTION "aw_guard_workflow_revision_delete"();
