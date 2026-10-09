-- Native C7 source erasure owns the existing trace sidecars and Memory outbox.
CREATE FUNCTION aw_provider_trace_source_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE erased boolean; marker text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM heartbeat_runs WHERE id=NEW.run_id AND company_id=NEW.company_id) THEN
  RAISE EXCEPTION 'Provider trace requires its native company run' USING ERRCODE='23514',CONSTRAINT='provider_trace_native_owner_check';
 END IF;
 marker=encode(sha256(convert_to(format('["%s","source",["august_works_provider_trace","run://%s"]]',NEW.company_id,NEW.run_id),'UTF8')),'hex');
 erased=NEW.reason='source_erased' OR aw_workflow_memory_erased(NEW.company_id,NEW.run_id,NULL)
  OR EXISTS(SELECT 1 FROM memory_deletion_markers WHERE company_id=NEW.company_id AND key=marker AND kind='source')
  OR EXISTS(SELECT 1 FROM companies WHERE id=NEW.company_id AND pause_reason='company_deleted');
 IF TG_OP='UPDATE' THEN erased=erased OR OLD.reason='source_erased'; END IF;
 IF erased THEN
  NEW.status='deleted'; NEW.deleted_at=coalesce(NEW.deleted_at,clock_timestamp());
  NEW.frame_count=0; NEW.byte_count=0; NEW.digest=NULL; NEW.reason='source_erased'; NEW.requested_by='source-erasure';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER provider_trace_source_guard BEFORE INSERT OR UPDATE ON provider_trace_records FOR EACH ROW EXECUTE FUNCTION aw_provider_trace_source_guard();
--> statement-breakpoint
CREATE FUNCTION aw_provider_trace_erasure_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE trace provider_trace_records%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN trace=OLD; ELSE trace=NEW; IF trace.reason IS DISTINCT FROM 'source_erased' THEN RETURN NEW; END IF; END IF;
 IF NOT EXISTS(SELECT 1 FROM companies WHERE id=trace.company_id) THEN RETURN trace; END IF;
 INSERT INTO memory_deletion_markers(company_id,key,kind,deleted_at) VALUES(trace.company_id,
  encode(sha256(convert_to(format('["%s","source",["august_works_provider_trace","run://%s"]]',trace.company_id,trace.run_id),'UTF8')),'hex'),'source',clock_timestamp()) ON CONFLICT DO NOTHING;
 IF trace.trace_ref='00000000-0000-0000-0000-000000000000.ndjson' THEN RETURN trace; END IF;
 INSERT INTO memory_jobs(company_id,operation_type,job_key,source_ref_json)
 VALUES(trace.company_id,'retention','provider-trace-erasure:v1:'||trace.id,
  jsonb_build_object('kind','provider_trace_erasure','traceId',trace.id,'runId',trace.run_id,'traceRef',trace.trace_ref))
 ON CONFLICT(company_id,job_key,attempt_number) DO UPDATE SET
  status='queued',execution_owner_id=NULL,lease_expires_at=NULL,finished_at=NULL,result_json=NULL,result_summary=NULL,error=NULL,error_code=NULL,updated_at=clock_timestamp()
 WHERE memory_jobs.status IN ('succeeded','failed','cancelled');
 RETURN trace;
END $$;
--> statement-breakpoint
CREATE TRIGGER provider_trace_erasure_outbox AFTER INSERT OR UPDATE OR DELETE ON provider_trace_records FOR EACH ROW EXECUTE FUNCTION aw_provider_trace_erasure_outbox();
--> statement-breakpoint
CREATE FUNCTION aw_memory_trace_erased() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.deleted_at IS NOT NULL THEN
  UPDATE provider_trace_records SET reason='source_erased',updated_at=clock_timestamp()
   WHERE company_id=NEW.company_id AND reason IS DISTINCT FROM 'source_erased'
    AND aw_workflow_memory_erased(company_id,run_id,NULL);
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER memory_trace_erased AFTER UPDATE OF deleted_at ON memory_records FOR EACH ROW EXECUTE FUNCTION aw_memory_trace_erased();
