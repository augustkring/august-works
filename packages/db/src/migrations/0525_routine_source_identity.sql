-- Keep routine execution provenance bound to
-- the same owning routine and retained revision, while allowing operational
-- run updates and the existing conversation-source erasure transformation.

CREATE OR REPLACE FUNCTION aw_guard_routine_source_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  revision_exists boolean;
  reference_exists boolean;
  erased_snapshot jsonb;
BEGIN
  IF TG_TABLE_NAME = 'routines' THEN
    IF TG_OP = 'UPDATE'
      AND (NEW.id, NEW.company_id, NEW.origin_kind, NEW.origin_id)
        IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.origin_kind, OLD.origin_id) THEN
      RAISE EXCEPTION 'Routine identity cannot be retargeted' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  ELSIF TG_TABLE_NAME = 'routine_revisions' THEN
    IF TG_OP = 'INSERT' THEN
      PERFORM 1 FROM routines r
        WHERE r.company_id = NEW.company_id AND r.id = NEW.routine_id
        FOR KEY SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Routine revision owner is unavailable' USING ERRCODE = '23514';
      END IF;
      IF NEW.snapshot->>'version' IS DISTINCT FROM '1'
        OR NEW.snapshot->'routine'->>'id' IS DISTINCT FROM NEW.routine_id::text
        OR NEW.snapshot->'routine'->>'companyId' IS DISTINCT FROM NEW.company_id::text THEN
        RAISE EXCEPTION 'Routine revision snapshot owner is unavailable' USING ERRCODE = '23514';
      END IF;
      IF NEW.restored_from_revision_id IS NOT NULL THEN
        PERFORM 1 FROM routine_revisions rr
          WHERE rr.company_id = NEW.company_id AND rr.routine_id = NEW.routine_id
            AND rr.id = NEW.restored_from_revision_id
          FOR KEY SHARE;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Restored routine revision owner is unavailable' USING ERRCODE = '23514';
        END IF;
      END IF;
      RETURN NEW;
    END IF;

    IF (NEW.id, NEW.company_id, NEW.routine_id, NEW.revision_number)
      IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.routine_id, OLD.revision_number) THEN
      RAISE EXCEPTION 'Routine revision identity cannot be retargeted' USING ERRCODE = '23514';
    END IF;

    -- Keep the existing ON DELETE SET NULL semantics for these attribution
    -- references, but do not permit a caller to substitute or clear a live FK.
    IF NEW.restored_from_revision_id IS DISTINCT FROM OLD.restored_from_revision_id THEN
      SELECT EXISTS(SELECT 1 FROM routine_revisions rr WHERE rr.id = OLD.restored_from_revision_id)
        INTO reference_exists;
      IF NEW.restored_from_revision_id IS NOT NULL OR reference_exists THEN
        RAISE EXCEPTION 'Routine revision reference cannot be retargeted' USING ERRCODE = '23514';
      END IF;
    END IF;
    IF NEW.created_by_agent_id IS DISTINCT FROM OLD.created_by_agent_id THEN
      SELECT EXISTS(SELECT 1 FROM agents a WHERE a.id = OLD.created_by_agent_id)
        INTO reference_exists;
      IF NEW.created_by_agent_id IS NOT NULL OR reference_exists THEN
        RAISE EXCEPTION 'Routine revision creator cannot be retargeted' USING ERRCODE = '23514';
      END IF;
    END IF;
    IF NEW.created_by_run_id IS DISTINCT FROM OLD.created_by_run_id THEN
      SELECT EXISTS(SELECT 1 FROM heartbeat_runs h WHERE h.id = OLD.created_by_run_id)
        INTO reference_exists;
      IF NEW.created_by_run_id IS NOT NULL OR reference_exists THEN
        RAISE EXCEPTION 'Routine revision creator run cannot be retargeted' USING ERRCODE = '23514';
      END IF;
    END IF;

    IF ROW(NEW.title, NEW.description, NEW.snapshot, NEW.change_summary,
           NEW.created_by_user_id, NEW.responsible_user_id, NEW.created_at)
      IS DISTINCT FROM ROW(OLD.title, OLD.description, OLD.snapshot, OLD.change_summary,
           OLD.created_by_user_id, OLD.responsible_user_id, OLD.created_at) THEN
      IF NOT aw_conversation_routine_source_erased(OLD.company_id, OLD.routine_id)
        OR ROW(NEW.created_by_user_id, NEW.responsible_user_id, NEW.created_at)
           IS DISTINCT FROM ROW(OLD.created_by_user_id, OLD.responsible_user_id, OLD.created_at) THEN
        RAISE EXCEPTION 'Routine revision snapshot is immutable' USING ERRCODE = '23514';
      END IF;

      erased_snapshot := jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(OLD.snapshot, '{routine,title}', '"Source-erased routine"'::jsonb),
                '{routine,description}', 'null'::jsonb),
              '{routine,variables}', '[]'::jsonb),
            '{routine,env}', 'null'::jsonb),
          '{routine,status}', '"paused"'::jsonb),
        '{triggers}', '[]'::jsonb);
      IF NEW.title IS DISTINCT FROM 'Source-erased routine'
        OR NEW.description IS NOT NULL
        OR NEW.change_summary IS NOT NULL
        OR NEW.snapshot IS DISTINCT FROM erased_snapshot THEN
        RAISE EXCEPTION 'Routine revision snapshot is immutable' USING ERRCODE = '23514';
      END IF;
    END IF;
    RETURN NEW;
  ELSIF TG_TABLE_NAME = 'routine_runs' THEN
    IF TG_OP = 'INSERT' THEN
      PERFORM 1 FROM routines r
        WHERE r.company_id = NEW.company_id AND r.id = NEW.routine_id
        FOR KEY SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Routine execution owner is unavailable' USING ERRCODE = '23514';
      END IF;
      IF NEW.routine_revision_id IS NOT NULL THEN
        PERFORM 1 FROM routine_revisions rr
          WHERE rr.company_id = NEW.company_id AND rr.routine_id = NEW.routine_id
            AND rr.id = NEW.routine_revision_id
          FOR KEY SHARE;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Routine execution revision owner is unavailable' USING ERRCODE = '23514';
        END IF;
      END IF;
      RETURN NEW;
    END IF;

    IF (NEW.id, NEW.company_id, NEW.routine_id)
      IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.routine_id) THEN
      RAISE EXCEPTION 'Routine execution owner cannot be retargeted' USING ERRCODE = '23514';
    END IF;
    IF NEW.routine_revision_id IS DISTINCT FROM OLD.routine_revision_id THEN
      -- Preserve the existing ON DELETE SET NULL behavior while preventing an
      -- ordinary UPDATE from discarding or substituting retained provenance.
      SELECT EXISTS(SELECT 1 FROM routine_revisions rr WHERE rr.id = OLD.routine_revision_id)
        INTO revision_exists;
      IF NEW.routine_revision_id IS NOT NULL OR revision_exists THEN
        RAISE EXCEPTION 'Routine execution revision cannot be retargeted' USING ERRCODE = '23514';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER zzz_routine_source_identity_guard
BEFORE UPDATE ON routines
FOR EACH ROW EXECUTE FUNCTION aw_guard_routine_source_identity();
--> statement-breakpoint
CREATE TRIGGER zzz_routine_source_identity_guard
BEFORE INSERT OR UPDATE ON routine_revisions
FOR EACH ROW EXECUTE FUNCTION aw_guard_routine_source_identity();
--> statement-breakpoint
CREATE TRIGGER zzz_routine_source_identity_guard
BEFORE INSERT OR UPDATE ON routine_runs
FOR EACH ROW EXECUTE FUNCTION aw_guard_routine_source_identity();
