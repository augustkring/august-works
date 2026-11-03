ALTER TABLE "context_manifest_items" ADD COLUMN "payload_source_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "document_revisions" ADD COLUMN "payload_source_protocol_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "document_revisions" ADD COLUMN "payload_source_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "issue_attachments" ADD COLUMN "payload_source_protocol_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "issue_attachments" ADD COLUMN "payload_source_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "issue_comments" ADD COLUMN "payload_source_protocol_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "issue_comments" ADD COLUMN "payload_source_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "payload_source_protocol_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "payload_source_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "memory_records" ADD COLUMN "payload_source_protocol_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "memory_records" ADD COLUMN "payload_source_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "payload_source_protocol_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "payload_source_snapshot" jsonb;
--> statement-breakpoint
-- Hash only the original owner's payload fields. Operational status, locks,
-- read timestamps and current ACLs remain independently mutable policy facts.
-- JSONB is canonicalized by PostgreSQL at both production and verification;
-- do not substitute a JavaScript object-stringification hash.
CREATE FUNCTION public.aw_native_payload_body_hash(kind text, row_data jsonb) RETURNS text
LANGUAGE plpgsql STABLE STRICT SET search_path = pg_catalog, public AS $$
DECLARE fields text[]; body jsonb;
BEGIN
  CASE kind
    WHEN 'issue' THEN fields := ARRAY['title','description','work_mode','billing_code','assignee_adapter_overrides','execution_policy','execution_state','monitor_notes','execution_workspace_preference','execution_workspace_settings','unblock_descriptor','forecast_reason'];
    WHEN 'project' THEN fields := ARRAY['name','description','roadmap_policy','env','execution_workspace_policy','pause_reason','color','icon'];
    WHEN 'memory_record' THEN fields := ARRAY['title','content','summary','metadata','revocation_reason','source_run_ids','source_issue_ids','source_project_ids','source_memory_ids','source_foundation_revision_ids'];
    WHEN 'comment' THEN fields := ARRAY['body','presentation','metadata'];
    WHEN 'document_revision' THEN fields := ARRAY['title','format','body','change_summary'];
    WHEN 'attachment' THEN fields := ARRAY['issue_id','asset_id','issue_comment_id'];
    ELSE RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Unknown native payload owner';
  END CASE;
  SELECT jsonb_object_agg(field, coalesce(row_data->field,'null'::jsonb)) INTO body FROM unnest(fields) field;
  IF kind='memory_record' THEN
    body := body || jsonb_build_object('evidence',coalesce((
      SELECT jsonb_agg((to_jsonb(e)-'company_id'-'memory_record_id'-'created_at'-'observed_at'-'source_updated_at')
        || jsonb_build_object('created_at',extract(epoch FROM e.created_at),'observed_at',extract(epoch FROM e.observed_at),
          'source_updated_at',extract(epoch FROM e.source_updated_at)) ORDER BY e.id)
      FROM public.memory_evidence e WHERE e.company_id=(row_data->>'company_id')::uuid AND e.memory_record_id=(row_data->>'id')::uuid
    ),'[]'::jsonb));
  ELSIF kind='attachment' THEN
    body := body || jsonb_build_object('asset',(
      SELECT jsonb_build_object('id',a.id,'provider',a.provider,'objectKey',a.object_key,'sha256',a.sha256,
        'byteSize',a.byte_size,'contentType',a.content_type,'originalFilename',a.original_filename)
      FROM public.assets a WHERE a.company_id=(row_data->>'company_id')::uuid AND a.id=(row_data->>'asset_id')::uuid
    ));
  END IF;
  RETURN encode(sha256(convert_to(body::text,'UTF8')),'hex');
END;
$$;
--> statement-breakpoint
-- This is binding/integrity, never source completeness or authorization.
-- Historical writers remain protocol0 and cannot upgrade old payloads. New
-- protocol1 payloads may be unknown (NULL), which readers must withhold.
CREATE FUNCTION public.aw_native_payload_source_binding() RETURNS trigger
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
  END IF;
  snapshot := NEW.payload_source_snapshot;
  IF snapshot IS NULL THEN RETURN NEW; END IF;
  row_data := to_jsonb(NEW);
  IF NEW.payload_source_protocol_version <> 1 OR jsonb_typeof(snapshot) IS DISTINCT FROM 'object'
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
CREATE TRIGGER issues_payload_source_binding BEFORE INSERT OR UPDATE ON public.issues
FOR EACH ROW EXECUTE FUNCTION public.aw_native_payload_source_binding('issue');

--> statement-breakpoint
CREATE TRIGGER projects_payload_source_binding BEFORE INSERT OR UPDATE ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.aw_native_payload_source_binding('project');

--> statement-breakpoint
CREATE TRIGGER memory_records_payload_source_binding BEFORE INSERT OR UPDATE ON public.memory_records
FOR EACH ROW EXECUTE FUNCTION public.aw_native_payload_source_binding('memory_record');

--> statement-breakpoint
CREATE TRIGGER issue_comments_payload_source_binding BEFORE INSERT OR UPDATE ON public.issue_comments
FOR EACH ROW EXECUTE FUNCTION public.aw_native_payload_source_binding('comment');

--> statement-breakpoint
CREATE TRIGGER document_revisions_payload_source_binding BEFORE INSERT OR UPDATE ON public.document_revisions
FOR EACH ROW EXECUTE FUNCTION public.aw_native_payload_source_binding('document_revision');

--> statement-breakpoint
CREATE TRIGGER issue_attachments_payload_source_binding BEFORE INSERT OR UPDATE ON public.issue_attachments
FOR EACH ROW EXECUTE FUNCTION public.aw_native_payload_source_binding('attachment');

--> statement-breakpoint
-- Child payload mutation cannot leave its parent's old proof intact. Native
-- writers restamp only from actual captured inputs; NULL is unknown, not empty.
CREATE FUNCTION public.aw_invalidate_memory_evidence_payload() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP<>'INSERT' THEN
    UPDATE public.memory_records SET payload_source_snapshot=NULL
      WHERE company_id=OLD.company_id AND id=OLD.memory_record_id AND payload_source_snapshot IS NOT NULL;
  END IF;
  IF TG_OP<>'DELETE' THEN
    UPDATE public.memory_records SET payload_source_snapshot=NULL
      WHERE company_id=NEW.company_id AND id=NEW.memory_record_id AND payload_source_snapshot IS NOT NULL;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER memory_evidence_invalidate_payload AFTER INSERT OR UPDATE OR DELETE ON public.memory_evidence
FOR EACH ROW EXECUTE FUNCTION public.aw_invalidate_memory_evidence_payload();
--> statement-breakpoint
CREATE FUNCTION public.aw_invalidate_attachment_asset_payload() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF ROW(NEW.provider,NEW.object_key,NEW.sha256,NEW.byte_size,NEW.content_type,NEW.original_filename)
      IS DISTINCT FROM ROW(OLD.provider,OLD.object_key,OLD.sha256,OLD.byte_size,OLD.content_type,OLD.original_filename) THEN
    UPDATE public.issue_attachments SET payload_source_snapshot=NULL
      WHERE company_id=OLD.company_id AND asset_id=OLD.id AND payload_source_snapshot IS NOT NULL;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER assets_invalidate_attachment_payload AFTER UPDATE ON public.assets
FOR EACH ROW EXECUTE FUNCTION public.aw_invalidate_attachment_asset_payload();
--> statement-breakpoint
-- A selected rendition is immutable. Retention may delete the native owner;
-- source history cannot be rewritten or upgraded from later live source bytes.
CREATE FUNCTION public.aw_immutable_context_selection() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Captured Context selection is immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER context_manifest_items_immutable_selection BEFORE UPDATE ON public.context_manifest_items
FOR EACH ROW EXECUTE FUNCTION public.aw_immutable_context_selection();
--> statement-breakpoint
CREATE TRIGGER context_manifests_immutable_selection BEFORE UPDATE ON public.context_manifests
FOR EACH ROW EXECUTE FUNCTION public.aw_immutable_context_selection();
