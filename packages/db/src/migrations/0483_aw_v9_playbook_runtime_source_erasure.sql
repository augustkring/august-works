-- Retire actual consumers of approved Playbook bodies through the existing
-- Native Source marker and Memory cleanup outbox. Financial rows are retained.
CREATE FUNCTION aw_v9_playbook_source_run_erasure() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE execution uuid;
BEGIN
 IF TG_OP='UPDATE' AND NOT aw_learning_asset_erased(OLD.company_id,'document_revision',OLD.id) THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('business-events:'||OLD.company_id::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('memory:privacy:'||OLD.company_id::text,0));
 FOR execution IN
  SELECT h.id FROM heartbeat_runs h WHERE h.company_id=OLD.company_id AND EXISTS(
   SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(h.context_snapshot->'agentProcedurePlaybookVersions')='array'
    THEN h.context_snapshot->'agentProcedurePlaybookVersions' ELSE '[]'::jsonb END) pin
    WHERE pin->>'revisionId'=OLD.id::text)
  UNION
  SELECT DISTINCT e.run_id FROM agent_execution_manifests e
   JOIN agent_execution_manifest_items i ON i.company_id=e.company_id AND i.manifest_id=e.id
   WHERE e.company_id=OLD.company_id AND i.type='playbook' AND i.version_ref=OLD.id::text
 LOOP
  INSERT INTO memory_deletion_markers(company_id,key,kind)
   VALUES(OLD.company_id,'native-playbook-source-revision-erasure:v1:'||OLD.id::text,'source') ON CONFLICT DO NOTHING;
  INSERT INTO memory_deletion_markers(company_id,key,kind)
   VALUES(OLD.company_id,'native-runtime-source-version-erasure:v1:'||execution::text||':'||OLD.id::text,'source') ON CONFLICT DO NOTHING;
  INSERT INTO memory_jobs(company_id,operation_type,job_key,source_ref_json)
   VALUES(OLD.company_id,'retention','runtime-playbook-source-erasure:v1:'||execution::text||':'||OLD.id::text,
    jsonb_build_object('kind','runtime_playbook_source_erasure','runId',execution::text,'versionId',OLD.id::text)) ON CONFLICT DO NOTHING;
 END LOOP;
 IF TG_OP='UPDATE' THEN RETURN NEW; END IF;
 RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER aaa_v9_playbook_source_run_delete BEFORE DELETE ON document_revisions
 FOR EACH ROW EXECUTE FUNCTION aw_v9_playbook_source_run_erasure();
--> statement-breakpoint
CREATE TRIGGER aaa_v9_playbook_source_run_payload BEFORE UPDATE ON document_revisions
 FOR EACH ROW EXECUTE FUNCTION aw_v9_playbook_source_run_erasure();
--> statement-breakpoint
CREATE FUNCTION aw_v9_playbook_source_restore_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM memory_deletion_markers WHERE kind='source'
    AND key='native-playbook-source-revision-erasure:v1:'||NEW.id::text) THEN
  RAISE EXCEPTION USING ERRCODE='23514',CONSTRAINT='aw_v9_playbook_source_restore_guard',MESSAGE='The consumed Playbook Source identity was erased';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v9_playbook_source_restore BEFORE INSERT ON document_revisions
 FOR EACH ROW EXECUTE FUNCTION aw_v9_playbook_source_restore_guard();
