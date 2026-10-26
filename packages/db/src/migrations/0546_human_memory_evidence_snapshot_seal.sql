-- Human-authored Memory may attach new canonical Task evidence while retaining
-- its complete original provenance. Keep the old snapshot available only as
-- an invalidated monotonicity witness until the same owner transaction seals
-- a new snapshot over the current body and evidence. Agent/native outputs keep
-- the original irreversible invalidation behavior.
CREATE OR REPLACE FUNCTION public.aw_native_payload_source_binding() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE snapshot jsonb; row_data jsonb; owner_kind text := TG_ARGV[0];
BEGIN
  IF NEW.payload_source_protocol_version NOT IN (0,1) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Unknown native payload source protocol';
  END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.payload_source_protocol_version IS DISTINCT FROM OLD.payload_source_protocol_version THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Native payload source protocol is insert-only';
    END IF;
    IF NEW.payload_source_snapshot_invalidated IS DISTINCT FROM OLD.payload_source_snapshot_invalidated THEN
      IF owner_kind='memory_record' THEN
        -- The evidence invalidation trigger may retain a stale snapshot as an
        -- inaccessible monotonicity witness. It cannot change any other field.
        IF to_jsonb(OLD)->>'created_by_actor_type'='user' AND OLD.payload_source_protocol_version=1
          AND OLD.payload_source_snapshot IS NOT NULL AND OLD.payload_source_snapshot_invalidated=false
          AND NEW.payload_source_snapshot_invalidated=true
          AND NEW.payload_source_snapshot IS NOT DISTINCT FROM OLD.payload_source_snapshot
          AND pg_trigger_depth()>1
          AND (to_jsonb(NEW)-'payload_source_snapshot_invalidated')=(to_jsonb(OLD)-'payload_source_snapshot_invalidated') THEN
          RETURN NEW;
        END IF;
        IF to_jsonb(OLD)->>'created_by_actor_type'='user' AND OLD.payload_source_protocol_version=1
          AND OLD.payload_source_snapshot IS NOT NULL AND OLD.payload_source_snapshot_invalidated=true
          AND NEW.payload_source_snapshot_invalidated=false AND NEW.payload_source_snapshot IS NOT NULL THEN
          snapshot := NEW.payload_source_snapshot;
          -- Source fields are merged in the preceding invalidated state. The
          -- final reseal itself may only replace the snapshot and clear its
          -- marker; it cannot change the already-bound body or owner fields.
          IF (to_jsonb(NEW)-ARRAY['payload_source_snapshot','payload_source_snapshot_invalidated','updated_at'])
              IS DISTINCT FROM
             (to_jsonb(OLD)-ARRAY['payload_source_snapshot','payload_source_snapshot_invalidated','updated_at']) THEN
            RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Human Memory evidence seal cannot change its body or owner';
          END IF;
          IF jsonb_typeof(OLD.payload_source_snapshot->'inputs') IS DISTINCT FROM 'array'
            OR jsonb_typeof(snapshot->'inputs') IS DISTINCT FROM 'array' THEN
            RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Human Memory evidence seal requires Task source history';
          END IF;
          IF (CASE WHEN jsonb_typeof(OLD.payload_source_snapshot->'inputs')='array'
              THEN jsonb_array_length(OLD.payload_source_snapshot->'inputs')>0 ELSE false END) IS NOT TRUE
            OR (CASE WHEN jsonb_typeof(snapshot->'inputs')='array'
              THEN jsonb_array_length(snapshot->'inputs')>0 ELSE false END) IS NOT TRUE THEN
            RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Human Memory evidence seal requires Task source history';
          END IF;
          IF EXISTS (SELECT 1 FROM jsonb_array_elements(OLD.payload_source_snapshot->'inputs') AS e(item)
              WHERE e.item->>'kind' IS DISTINCT FROM 'task')
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(snapshot->'inputs') AS e(item)
              WHERE e.item->>'kind' IS DISTINCT FROM 'task') THEN
            RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Human Memory evidence seal accepts only Task sources';
          END IF;
          row_data := to_jsonb(NEW);
          IF jsonb_typeof(snapshot) IS DISTINCT FROM 'object'
            OR snapshot->'version' IS DISTINCT FROM '1'::jsonb
            OR snapshot->'owner'->>'kind' IS DISTINCT FROM owner_kind
            OR snapshot->'owner'->>'companyId' IS DISTINCT FROM NEW.company_id::text
            OR snapshot->'owner'->>'id' IS DISTINCT FROM NEW.id::text
            OR snapshot->'owner'->>'contentHash' IS DISTINCT FROM public.aw_native_payload_body_hash(owner_kind,row_data)
            OR snapshot->>'digest' IS DISTINCT FROM encode(sha256(convert_to((snapshot-'digest')::text,'UTF8')),'hex')
            OR OLD.payload_source_snapshot->>'digest' IS DISTINCT FROM encode(sha256(convert_to((OLD.payload_source_snapshot-'digest')::text,'UTF8')),'hex')
            OR ((snapshot->'inputs') @> (OLD.payload_source_snapshot->'inputs')) IS NOT TRUE
            OR ((snapshot->'policy'->'issueIds') @> (OLD.payload_source_snapshot->'policy'->'issueIds')) IS NOT TRUE
            OR ((snapshot->'policy'->'projectIds') @> (OLD.payload_source_snapshot->'policy'->'projectIds')) IS NOT TRUE
            OR ((snapshot->'policy'->'runIds') @> (OLD.payload_source_snapshot->'policy'->'runIds')) IS NOT TRUE
            OR ((snapshot->'policy'->'memoryIds') @> (OLD.payload_source_snapshot->'policy'->'memoryIds')) IS NOT TRUE
            OR ((snapshot->'policy'->'foundationRevisionIds') @> (OLD.payload_source_snapshot->'policy'->'foundationRevisionIds')) IS NOT TRUE THEN
            RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Human Memory evidence seal does not retain its source history';
          END IF;
          RETURN NEW;
        END IF;
      END IF;
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Native payload source invalidation marker is server-owned';
    END IF;
    IF OLD.payload_source_snapshot_invalidated THEN
      IF owner_kind='memory_record' AND to_jsonb(OLD)->>'created_by_actor_type'='user'
        AND OLD.payload_source_protocol_version=1 AND OLD.payload_source_snapshot IS NOT NULL
        AND NEW.payload_source_snapshot_invalidated=true
        AND NEW.payload_source_snapshot IS NOT DISTINCT FROM OLD.payload_source_snapshot
        AND (to_jsonb(NEW)-ARRAY['source_provenance_qualified','source_run_ids','source_issue_ids','source_project_ids',
          'source_memory_ids','source_foundation_revision_ids','updated_at'])
          =(to_jsonb(OLD)-ARRAY['source_provenance_qualified','source_run_ids','source_issue_ids','source_project_ids',
            'source_memory_ids','source_foundation_revision_ids','updated_at']) THEN
        RETURN NEW;
      END IF;
      IF NEW.payload_source_snapshot IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Invalidated native payload source snapshot cannot be rebound';
      END IF;
      RETURN NEW;
    END IF;
    IF OLD.payload_source_snapshot IS NOT NULL AND NEW.payload_source_snapshot IS NULL THEN
      NEW.payload_source_snapshot_invalidated := true;
      RETURN NEW;
    END IF;
  END IF;
  snapshot := NEW.payload_source_snapshot;
  IF snapshot IS NULL THEN RETURN NEW; END IF;
  row_data := to_jsonb(NEW);
  IF NEW.payload_source_protocol_version <> 1 OR NEW.payload_source_snapshot_invalidated
      OR jsonb_typeof(snapshot) IS DISTINCT FROM 'object'
      OR snapshot->'version' IS DISTINCT FROM '1'::jsonb
      OR snapshot->'owner'->>'kind' IS DISTINCT FROM owner_kind
      OR snapshot->'owner'->>'companyId' IS DISTINCT FROM NEW.company_id::text
      OR snapshot->'owner'->>'id' IS DISTINCT FROM NEW.id::text
      OR snapshot->'owner'->>'contentHash' IS DISTINCT FROM public.aw_native_payload_body_hash(owner_kind,row_data)
      OR snapshot->>'digest' IS DISTINCT FROM encode(sha256(convert_to((snapshot-'digest')::text,'UTF8')),'hex') THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Native payload source snapshot does not bind its owner and body';
  END IF;
  IF TG_OP='UPDATE' AND OLD.payload_source_snapshot IS NOT NULL THEN
    IF ((snapshot->'inputs') @> (OLD.payload_source_snapshot->'inputs')) IS NOT TRUE
      OR ((snapshot->'policy'->'issueIds') @> (OLD.payload_source_snapshot->'policy'->'issueIds')) IS NOT TRUE
      OR ((snapshot->'policy'->'projectIds') @> (OLD.payload_source_snapshot->'policy'->'projectIds')) IS NOT TRUE
      OR ((snapshot->'policy'->'runIds') @> (OLD.payload_source_snapshot->'policy'->'runIds')) IS NOT TRUE
      OR ((snapshot->'policy'->'memoryIds') @> (OLD.payload_source_snapshot->'policy'->'memoryIds')) IS NOT TRUE
      OR ((snapshot->'policy'->'foundationRevisionIds') @> (OLD.payload_source_snapshot->'policy'->'foundationRevisionIds')) IS NOT TRUE THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Native payload source snapshot cannot discard retained inputs';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.aw_invalidate_memory_evidence_payload() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE owner_row public.memory_records%ROWTYPE;
BEGIN
  IF TG_OP<>'INSERT' THEN
    SELECT * INTO owner_row FROM public.memory_records WHERE company_id=OLD.company_id AND id=OLD.memory_record_id;
    IF FOUND AND owner_row.payload_source_protocol_version=1 AND owner_row.payload_source_snapshot IS NOT NULL
      AND NOT owner_row.payload_source_snapshot_invalidated AND owner_row.created_by_actor_type='user' THEN
      UPDATE public.memory_records SET payload_source_snapshot_invalidated=true
        WHERE company_id=OLD.company_id AND id=OLD.memory_record_id AND NOT payload_source_snapshot_invalidated;
    ELSE
      UPDATE public.memory_records SET payload_source_snapshot=NULL
        WHERE company_id=OLD.company_id AND id=OLD.memory_record_id AND payload_source_snapshot IS NOT NULL;
    END IF;
  END IF;
  IF TG_OP<>'DELETE' THEN
    SELECT * INTO owner_row FROM public.memory_records WHERE company_id=NEW.company_id AND id=NEW.memory_record_id;
    IF FOUND AND owner_row.payload_source_protocol_version=1 AND owner_row.payload_source_snapshot IS NOT NULL
      AND NOT owner_row.payload_source_snapshot_invalidated AND owner_row.created_by_actor_type='user' THEN
      UPDATE public.memory_records SET payload_source_snapshot_invalidated=true
        WHERE company_id=NEW.company_id AND id=NEW.memory_record_id AND NOT payload_source_snapshot_invalidated;
    ELSE
      UPDATE public.memory_records SET payload_source_snapshot=NULL
        WHERE company_id=NEW.company_id AND id=NEW.memory_record_id AND payload_source_snapshot IS NOT NULL;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
