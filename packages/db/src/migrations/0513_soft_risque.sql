ALTER TABLE "document_revisions" ADD COLUMN "payload_source_snapshot_invalidated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "issue_attachments" ADD COLUMN "payload_source_snapshot_invalidated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "issue_comments" ADD COLUMN "payload_source_snapshot_invalidated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "payload_source_snapshot_invalidated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "memory_records" ADD COLUMN "payload_source_snapshot_invalidated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "payload_source_snapshot_invalidated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- A v1 row whose source proof was cleared has lost its historical binding.
-- Preserve that fact conservatively across upgrades; NULL remains unknown.
UPDATE public.document_revisions SET payload_source_snapshot_invalidated=true
  WHERE payload_source_protocol_version=1 AND payload_source_snapshot IS NULL;
--> statement-breakpoint
UPDATE public.issue_attachments SET payload_source_snapshot_invalidated=true
  WHERE payload_source_protocol_version=1 AND payload_source_snapshot IS NULL;
--> statement-breakpoint
UPDATE public.issue_comments SET payload_source_snapshot_invalidated=true
  WHERE payload_source_protocol_version=1 AND payload_source_snapshot IS NULL;
--> statement-breakpoint
UPDATE public.issues SET payload_source_snapshot_invalidated=true
  WHERE payload_source_protocol_version=1 AND payload_source_snapshot IS NULL;
--> statement-breakpoint
UPDATE public.memory_records SET payload_source_snapshot_invalidated=true
  WHERE payload_source_protocol_version=1 AND payload_source_snapshot IS NULL;
--> statement-breakpoint
UPDATE public.projects SET payload_source_snapshot_invalidated=true
  WHERE payload_source_protocol_version=1 AND payload_source_snapshot IS NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.aw_native_payload_source_binding() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE snapshot jsonb; row_data jsonb; owner_kind text := TG_ARGV[0];
BEGIN
  IF TG_OP='INSERT' AND NEW.payload_source_snapshot_invalidated IS DISTINCT FROM false THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Native payload source invalidation marker is server-owned';
  END IF;
  IF TG_OP='UPDATE' AND NEW.payload_source_snapshot_invalidated IS DISTINCT FROM OLD.payload_source_snapshot_invalidated THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Native payload source invalidation marker is server-owned';
  END IF;
  IF NEW.payload_source_protocol_version NOT IN (0,1) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Unknown native payload source protocol';
  END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.payload_source_protocol_version IS DISTINCT FROM OLD.payload_source_protocol_version THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Native payload source protocol is insert-only';
    END IF;
    IF OLD.payload_source_snapshot_invalidated THEN
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
