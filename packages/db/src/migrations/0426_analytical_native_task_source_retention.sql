-- Extend the original analytical input C7 owner to actual native populations.
-- A deleted Task/project closes all retained Learning and Context copies even
-- when flags are off or the company is paused. No source prose is persisted.
CREATE OR REPLACE FUNCTION aw_analytical_input_context_erased() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE input_kind text; source_manifest uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM companies WHERE id=OLD.company_id) THEN RETURN OLD; END IF;
 input_kind=case TG_TABLE_NAME when 'business_metric_versions' then 'metric_version' when 'governance_obligations' then 'governance_obligation' when 'issues' then 'issue' when 'projects' then 'project' else null end;
 IF input_kind IS NULL THEN RAISE EXCEPTION 'Unsupported native analytical input owner'; END IF;
 INSERT INTO memory_deletion_markers(company_id,key,kind,deleted_at)
 VALUES(OLD.company_id,encode(sha256(convert_to(format('["%s","source",["august_works_analytical_input","%s://%s"]]',OLD.company_id,input_kind,OLD.id),'UTF8')),'hex'),'source',clock_timestamp()) ON CONFLICT DO NOTHING;
 FOR source_manifest IN SELECT DISTINCT manifest_id FROM analytical_lineage_edges WHERE company_id=OLD.company_id AND input_type=input_kind AND input_ref=OLD.id LOOP
  PERFORM aw_analytical_manifest_source_deleted(OLD.company_id,source_manifest);
 END LOOP;
 RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER issue_analytical_context_erased AFTER DELETE ON issues FOR EACH ROW EXECUTE FUNCTION aw_analytical_input_context_erased();
--> statement-breakpoint
CREATE TRIGGER project_analytical_context_erased AFTER DELETE ON projects FOR EACH ROW EXECUTE FUNCTION aw_analytical_input_context_erased();
--> statement-breakpoint
-- The existing retention sweep replays C7 and scrubs native copied payloads.
-- Queue it at the actual private Root transition, including FK-cascade source
-- deletion; its worker already runs with flags off and paused companies.
CREATE FUNCTION aw_analytical_context_erasure_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.deleted_at IS NOT NULL OR NEW.deleted_at IS NULL OR NOT EXISTS(SELECT 1 FROM companies WHERE id=NEW.company_id)
  OR NOT EXISTS(SELECT 1 FROM analytical_context_roots r WHERE r.company_id=NEW.company_id AND r.memory_record_id=NEW.id) THEN RETURN NEW; END IF;
 -- ponytail: original company marker scan per Root; coalesce jobs only after
 -- concurrent erasure watermarks and retries are qualified at higher volume.
 INSERT INTO memory_jobs(company_id,operation_type,job_key,source_ref_json)
  VALUES(NEW.company_id,'retention','analytical-context-erasure:v1:'||NEW.id,jsonb_build_object('kind','retention_sweep'))
  ON CONFLICT(company_id,job_key,attempt_number) DO UPDATE SET status='queued',execution_owner_id=NULL,lease_expires_at=NULL,finished_at=NULL,result_json=NULL,result_summary=NULL,error=NULL,error_code=NULL,updated_at=clock_timestamp() WHERE memory_jobs.status IN('succeeded','failed','cancelled');
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER analytical_context_erasure_outbox AFTER UPDATE OF deleted_at ON memory_records FOR EACH ROW EXECUTE FUNCTION aw_analytical_context_erasure_outbox();
--> statement-breakpoint
INSERT INTO memory_jobs(company_id,operation_type,job_key,source_ref_json)
 SELECT r.company_id,'retention','analytical-context-erasure:v1:'||r.memory_record_id,jsonb_build_object('kind','retention_sweep')
 FROM analytical_context_roots r JOIN memory_records m ON m.company_id=r.company_id AND m.id=r.memory_record_id WHERE m.deleted_at IS NOT NULL
 ON CONFLICT(company_id,job_key,attempt_number) DO NOTHING;
--> statement-breakpoint
-- Historical manifests may already refer to deleted native population inputs.
-- Mark exact original inputs, then reuse the existing manifest deletion owner.
DO $$
DECLARE missing record; source_manifest uuid;
BEGIN
 FOR missing IN SELECT DISTINCT e.company_id,e.input_type,e.input_ref FROM analytical_lineage_edges e
  WHERE (e.input_type='issue' AND NOT EXISTS(SELECT 1 FROM issues i WHERE i.company_id=e.company_id AND i.id=e.input_ref))
   OR (e.input_type='project' AND NOT EXISTS(SELECT 1 FROM projects p WHERE p.company_id=e.company_id AND p.id=e.input_ref)) LOOP
  INSERT INTO memory_deletion_markers(company_id,key,kind,deleted_at)
   VALUES(missing.company_id,encode(sha256(convert_to(format('["%s","source",["august_works_analytical_input","%s://%s"]]',missing.company_id,missing.input_type,missing.input_ref),'UTF8')),'hex'),'source',clock_timestamp()) ON CONFLICT DO NOTHING;
  FOR source_manifest IN SELECT DISTINCT manifest_id FROM analytical_lineage_edges WHERE company_id=missing.company_id AND input_type=missing.input_type AND input_ref=missing.input_ref LOOP
   PERFORM aw_analytical_manifest_source_deleted(missing.company_id,source_manifest);
  END LOOP;
 END LOOP;
END $$;
