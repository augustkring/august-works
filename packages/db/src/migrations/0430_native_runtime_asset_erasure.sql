-- Existing native run profiles own legacy global bundle references. New bundles
-- are run-scoped, so interrupted publication needs no new retention registry.
CREATE FUNCTION aw_queue_native_runtime_asset_erasure(company uuid, execution uuid, profile jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE refs text[]; batch text[]; offset_index integer; key text; legacy jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM companies WHERE id=company) THEN RETURN; END IF;
 SELECT coalesce(array_agg(DISTINCT r->>'digest' ORDER BY r->>'digest'),ARRAY[]::text[]) INTO refs
 FROM (
  SELECT profile #> '{nativeExecutionInput,runtimeContext,instructions,bundle}' r
  UNION ALL SELECT s->'bundle' FROM jsonb_array_elements(CASE
   WHEN jsonb_typeof(profile #> '{nativeExecutionInput,runtimeContext,skills}')='array'
   THEN profile #> '{nativeExecutionInput,runtimeContext,skills}' ELSE '[]'::jsonb END) s
 ) assets WHERE r->>'digest' ~ '^[a-f0-9]{64}$'
  AND r->>'rootPath' ~ ('/runtime-context-assets/bundles/'||(r->>'digest')||'$');
 -- Each original outbox job is bounded; all legacy references remain covered.
 FOR offset_index IN 0..greatest(0,(cardinality(refs)-1)/256) LOOP
  batch:=refs[offset_index*256+1:offset_index*256+256];legacy:=to_jsonb(coalesce(batch,ARRAY[]::text[]));
  key:='runtime-asset-erasure:v1:'||execution::text;
  IF cardinality(batch)>0 THEN key:=key||':'||encode(sha256(convert_to(array_to_string(batch,','),'UTF8')),'hex'); END IF;
  INSERT INTO memory_jobs(company_id,operation_type,job_key,source_ref_json)
   VALUES(company,'retention',key,jsonb_build_object('kind','runtime_asset_erasure','runId',execution::text,'legacyDigests',legacy))
   ON CONFLICT(company_id,job_key,attempt_number) DO UPDATE
   SET status='queued',finished_at=NULL,result_json=NULL,result_summary=NULL,error=NULL,error_code=NULL,updated_at=now()
   WHERE memory_jobs.status IN('succeeded','failed','cancelled');
 END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION aw_native_runtime_asset_erasure() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE company uuid; execution uuid;
BEGIN
 IF TG_OP='DELETE' THEN
  company:=OLD.company_id;execution:=OLD.id;
  PERFORM pg_advisory_xact_lock(hashtextextended('business-events:'||company::text,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('memory:privacy:'||company::text,0));
  PERFORM aw_queue_native_runtime_asset_erasure(company,execution,OLD.runner_profile_json);
  RETURN OLD;
 END IF;
 company:=NEW.company_id;execution:=NEW.id;
 IF aw_workflow_memory_erased(company,execution,NULL) THEN
  IF TG_OP='UPDATE' THEN PERFORM aw_queue_native_runtime_asset_erasure(company,execution,OLD.runner_profile_json); END IF;
  PERFORM aw_queue_native_runtime_asset_erasure(company,execution,NEW.runner_profile_json);
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
-- Before the original payload marker clears the profile, retain only native IDs/hashes.
CREATE TRIGGER aaa_native_runtime_asset_erasure BEFORE INSERT OR UPDATE OR DELETE ON heartbeat_runs
 FOR EACH ROW EXECUTE FUNCTION aw_native_runtime_asset_erasure();
--> statement-breakpoint
SELECT aw_queue_native_runtime_asset_erasure(company_id,id,runner_profile_json)
 FROM heartbeat_runs WHERE aw_workflow_memory_erased(company_id,id,NULL);
