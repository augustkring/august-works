ALTER TABLE "context_manifest_memory_roots" ADD COLUMN "payload_source_snapshot" jsonb;
--> statement-breakpoint
-- Original retained roots never acquire a later source body. NULL preserves
-- unknown historical captures, including the legacy analytical hash versions.
CREATE FUNCTION public.aw_context_memory_root_snapshot_binding() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE selected_snapshot jsonb; selected_version text;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Captured Context Memory root is immutable';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.payload_source_snapshot IS NULL THEN RETURN NEW; END IF;
  SELECT source.payload_source_snapshot,
    to_char(source.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    INTO selected_snapshot,selected_version
    FROM public.memory_records source
    WHERE source.company_id=NEW.company_id AND source.id=NEW.memory_record_id
      AND source.deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='Current Context Memory source is unavailable';
  END IF;
  IF NEW.payload_source_snapshot IS DISTINCT FROM selected_snapshot
    OR NEW.source_version IS DISTINCT FROM selected_version THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Context Memory snapshot or version differs from selected source';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
-- Reject UPDATE mutations before other source-key guards. DELETE retains its
-- original manifest/retention lifecycle; the Memory source has no deletion FK.
CREATE TRIGGER aa_context_memory_roots_snapshot_binding
BEFORE INSERT OR UPDATE ON public.context_manifest_memory_roots
FOR EACH ROW EXECUTE FUNCTION public.aw_context_memory_root_snapshot_binding();
