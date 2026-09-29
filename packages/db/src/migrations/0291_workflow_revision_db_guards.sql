CREATE OR REPLACE FUNCTION "aw_guard_workflow_revision_update"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    NEW."company_id",
    NEW."workflow_id",
    NEW."revision_number",
    NEW."graph_json",
    NEW."input_schema",
    NEW."output_schema",
    NEW."change_summary",
    NEW."created_by_user_id",
    NEW."created_by_agent_id",
    NEW."created_by_run_id",
    NEW."created_at"
  ) IS DISTINCT FROM ROW(
    OLD."company_id",
    OLD."workflow_id",
    OLD."revision_number",
    OLD."graph_json",
    OLD."input_schema",
    OLD."output_schema",
    OLD."change_summary",
    OLD."created_by_user_id",
    OLD."created_by_agent_id",
    OLD."created_by_run_id",
    OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'workflow revision snapshot content is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."state" IS DISTINCT FROM OLD."state"
     AND NOT (
       (OLD."state" = 'draft' AND NEW."state" IN ('published', 'discarded'))
       OR
       (OLD."state" = 'published' AND NEW."state" = 'superseded')
     ) THEN
    RAISE EXCEPTION 'invalid workflow revision state transition: % -> %', OLD."state", NEW."state"
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "workflow_revisions_immutable_snapshot_guard"
BEFORE UPDATE ON "workflow_revisions"
FOR EACH ROW
EXECUTE FUNCTION "aw_guard_workflow_revision_update"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "aw_check_workflow_revision_pointers"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  revision_company_id uuid;
  revision_workflow_id uuid;
  revision_state text;
BEGIN
  IF NEW."draft_revision_id" IS NOT NULL THEN
    SELECT "company_id", "workflow_id", "state"
    INTO revision_company_id, revision_workflow_id, revision_state
    FROM "workflow_revisions"
    WHERE "id" = NEW."draft_revision_id";

    IF NOT FOUND
       OR revision_company_id IS DISTINCT FROM NEW."company_id"
       OR revision_workflow_id IS DISTINCT FROM NEW."id"
       OR revision_state IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'workflow draft revision pointer is invalid'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."published_revision_id" IS NOT NULL THEN
    SELECT "company_id", "workflow_id", "state"
    INTO revision_company_id, revision_workflow_id, revision_state
    FROM "workflow_revisions"
    WHERE "id" = NEW."published_revision_id";

    IF NOT FOUND
       OR revision_company_id IS DISTINCT FROM NEW."company_id"
       OR revision_workflow_id IS DISTINCT FROM NEW."id"
       OR revision_state IS DISTINCT FROM 'published' THEN
      RAISE EXCEPTION 'workflow published revision pointer is invalid'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "workflows_revision_pointer_integrity"
AFTER INSERT OR UPDATE ON "workflows"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "aw_check_workflow_revision_pointers"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "aw_check_workflow_revision_backref"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  workflow_company_id uuid;
  workflow_draft_revision_id uuid;
  workflow_published_revision_id uuid;
BEGIN
  SELECT "company_id", "draft_revision_id", "published_revision_id"
  INTO workflow_company_id, workflow_draft_revision_id, workflow_published_revision_id
  FROM "workflows"
  WHERE "id" = NEW."workflow_id";

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF workflow_company_id IS DISTINCT FROM NEW."company_id" THEN
    RAISE EXCEPTION 'workflow revision company does not match workflow company'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."state" = 'draft' THEN
    IF workflow_draft_revision_id IS DISTINCT FROM NEW."id" THEN
      RAISE EXCEPTION 'draft workflow revision is not the workflow draft pointer'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."state" = 'published' THEN
    IF workflow_published_revision_id IS DISTINCT FROM NEW."id" THEN
      RAISE EXCEPTION 'published workflow revision is not the workflow published pointer'
        USING ERRCODE = '23514';
    END IF;
  ELSIF workflow_draft_revision_id = NEW."id"
     OR workflow_published_revision_id = NEW."id" THEN
    RAISE EXCEPTION 'terminal workflow revision cannot remain an active workflow pointer'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "workflow_revisions_pointer_backref_integrity"
AFTER INSERT OR UPDATE ON "workflow_revisions"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "aw_check_workflow_revision_backref"();
