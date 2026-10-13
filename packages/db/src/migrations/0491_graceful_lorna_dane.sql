ALTER TABLE "document_revisions" ADD COLUMN "conversation_foundation_proposal_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;

--> statement-breakpoint
CREATE FUNCTION aw_foundation_revision_sources_erased(company uuid, doc uuid, sources jsonb)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE source text; candidate uuid; count integer:=0;
BEGIN
 IF jsonb_typeof(sources) IS DISTINCT FROM 'array' OR jsonb_array_length(sources)>32 THEN RETURN true; END IF;
 FOR source IN SELECT jsonb_array_elements_text(sources) LOOP
  count:=count+1;
  IF source !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN RETURN true; END IF;
  candidate:=source::uuid;
  IF NOT EXISTS(SELECT 1 FROM foundation_change_proposals p JOIN foundation_documents f ON f.company_id=p.company_id AND f.id=p.foundation_document_id
    WHERE p.company_id=company AND p.id=candidate AND f.document_id=doc AND p.source_type='conversation_authoring')
    OR aw_conversation_foundation_proposal_erased(company,candidate) THEN RETURN true; END IF;
 END LOOP;
 RETURN count<>(SELECT count(DISTINCT v) FROM jsonb_array_elements_text(sources) v);
END $$;
--> statement-breakpoint
CREATE FUNCTION aw_guard_foundation_revision_sources() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prior jsonb; retained jsonb;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.conversation_foundation_proposal_ids IS DISTINCT FROM OLD.conversation_foundation_proposal_ids THEN
   RAISE EXCEPTION 'Foundation revision provenance is immutable' USING ERRCODE='23514';
  END IF;
 ELSE
  SELECT r.conversation_foundation_proposal_ids INTO prior FROM documents d JOIN document_revisions r
    ON r.company_id=d.company_id AND r.id=d.latest_revision_id AND r.document_id=d.id
    WHERE d.company_id=NEW.company_id AND d.id=NEW.document_id;
  IF jsonb_typeof(NEW.conversation_foundation_proposal_ids) IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION 'Foundation revision provenance is invalid' USING ERRCODE='23514';
  END IF;
  SELECT coalesce(jsonb_agg(v ORDER BY v),'[]'::jsonb) INTO retained FROM (
   SELECT DISTINCT v FROM jsonb_array_elements_text(coalesce(prior,'[]'::jsonb)||NEW.conversation_foundation_proposal_ids) v
  ) unique_sources;
  IF jsonb_array_length(retained)>32 THEN RAISE EXCEPTION 'Foundation revision source budget exceeded' USING ERRCODE='23514'; END IF;
  NEW.conversation_foundation_proposal_ids:=retained;
 END IF;
 IF aw_foundation_revision_sources_erased(NEW.company_id,NEW.document_id,NEW.conversation_foundation_proposal_ids) THEN
  NEW.title:=NULL; NEW.body:=''; NEW.change_summary:=NULL;
 END IF;
 IF EXISTS(SELECT 1 FROM memory_deletion_markers m WHERE m.company_id=NEW.company_id AND m.kind='source'
   AND m.key='conversation-foundation-revision-erasure:v1:'||NEW.id::text) THEN
  NEW.title:=NULL; NEW.body:=''; NEW.change_summary:=NULL;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_foundation_revision_sources_guard BEFORE INSERT OR UPDATE ON document_revisions
 FOR EACH ROW EXECUTE FUNCTION aw_guard_foundation_revision_sources();

--> statement-breakpoint
CREATE FUNCTION aw_foundation_revision_delete_marker() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.conversation_foundation_proposal_ids<>'[]'::jsonb THEN
  INSERT INTO memory_deletion_markers(company_id,kind,key)
   VALUES(OLD.company_id,'source','conversation-foundation-revision-erasure:v1:'||OLD.id::text) ON CONFLICT DO NOTHING;
 END IF;
 RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_foundation_revision_delete_marker BEFORE DELETE ON document_revisions
 FOR EACH ROW EXECUTE FUNCTION aw_foundation_revision_delete_marker();
--> statement-breakpoint
CREATE FUNCTION aw_guard_foundation_document_source_copy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE lost boolean;
BEGIN
 IF TG_TABLE_NAME='documents' THEN
  SELECT aw_foundation_revision_sources_erased(NEW.company_id,NEW.id,r.conversation_foundation_proposal_ids)
    OR EXISTS(SELECT 1 FROM memory_deletion_markers m WHERE m.company_id=NEW.company_id AND m.kind='source'
      AND m.key='conversation-foundation-revision-erasure:v1:'||r.id::text) INTO lost
    FROM document_revisions r WHERE r.company_id=NEW.company_id AND r.document_id=NEW.id AND r.id=NEW.latest_revision_id;
  IF lost THEN NEW.title:=NULL; NEW.latest_body:=''; END IF;
 ELSE
  SELECT aw_foundation_revision_sources_erased(NEW.company_id,r.document_id,r.conversation_foundation_proposal_ids)
    OR EXISTS(SELECT 1 FROM memory_deletion_markers m WHERE m.company_id=NEW.company_id AND m.kind='source'
      AND m.key='conversation-foundation-revision-erasure:v1:'||r.id::text) INTO lost
    FROM document_revisions r WHERE r.company_id=NEW.company_id AND r.id=NEW.document_revision_id;
  IF lost THEN NEW.heading_path:=ARRAY[]::text[]; NEW.body:=''; NEW.token_count:=0; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_foundation_document_source_copy_guard BEFORE INSERT OR UPDATE ON documents
 FOR EACH ROW EXECUTE FUNCTION aw_guard_foundation_document_source_copy();
--> statement-breakpoint
CREATE TRIGGER aw_foundation_section_source_copy_guard BEFORE INSERT OR UPDATE ON foundation_sections
 FOR EACH ROW EXECUTE FUNCTION aw_guard_foundation_document_source_copy();

--> statement-breakpoint
CREATE FUNCTION aw_foundation_context_source_erased(company uuid, execution uuid, task uuid)
RETURNS boolean LANGUAGE sql VOLATILE AS $$
 SELECT EXISTS(SELECT 1 FROM context_manifests c JOIN context_manifest_items item ON item.company_id=c.company_id AND item.manifest_id=c.id
  LEFT JOIN foundation_documents f ON f.company_id=c.company_id AND f.id=CASE WHEN split_part(item.source_ref,'/',3) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    THEN split_part(item.source_ref,'/',3)::uuid ELSE NULL END
  LEFT JOIN document_revisions r ON r.company_id=c.company_id AND r.document_id=f.document_id AND r.id=CASE
    WHEN split_part(item.source_ref,'/',4)='whole' THEN f.approved_revision_id
    WHEN split_part(item.source_ref,'/',4) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN split_part(item.source_ref,'/',4)::uuid ELSE NULL END
  WHERE c.company_id=company AND item.source_provider='august_works_foundation'
    AND ((execution IS NOT NULL AND (c.run_id=execution OR EXISTS(SELECT 1 FROM agent_execution_manifests e WHERE e.company_id=company AND e.run_id=execution AND e.context_manifest_id=c.id)))
      OR (task IS NOT NULL AND c.issue_id=task))
    AND (item.source_ref !~ '^foundation://' OR f.id IS NULL OR r.id IS NULL OR item.source_version IS DISTINCT FROM r.id::text
      OR EXISTS(SELECT 1 FROM memory_deletion_markers m WHERE m.company_id=company AND m.kind='source'
        AND m.key='conversation-foundation-revision-erasure:v1:'||r.id::text)
      OR aw_foundation_revision_sources_erased(company,r.document_id,r.conversation_foundation_proposal_ids)))
$$;
--> statement-breakpoint
DO $do$ BEGIN
 EXECUTE replace(pg_get_functiondef('aw_workflow_memory_erased(uuid,uuid,uuid)'::regprocedure),
  'CREATE OR REPLACE FUNCTION public.aw_workflow_memory_erased(',
  'CREATE OR REPLACE FUNCTION public.aw_workflow_memory_erased_before_foundation(');
END $do$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_workflow_memory_erased(company uuid, execution uuid, task uuid)
RETURNS boolean LANGUAGE sql VOLATILE AS $$
 SELECT aw_workflow_memory_erased_before_foundation(company,execution,task)
 OR aw_foundation_context_source_erased(company,execution,coalesce(task,(SELECT coalesce(h.native_issue_id,CASE
    WHEN coalesce(h.context_snapshot->>'issueId',h.context_snapshot->>'taskId') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN coalesce(h.context_snapshot->>'issueId',h.context_snapshot->>'taskId')::uuid ELSE NULL END)
   FROM heartbeat_runs h WHERE h.company_id=company AND h.id=execution)))
$$;
