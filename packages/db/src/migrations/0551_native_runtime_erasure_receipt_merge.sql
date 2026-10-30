-- Preserve the original per-Run runtime-asset outbox through canonical company
-- purge. A prior success is reusable only when its exact operation-bound base
-- receipt and canonical digest batches cover every Run profile reference.
CREATE OR REPLACE FUNCTION aw_queue_native_runtime_asset_erasure(company uuid, execution uuid, profile jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE refs text[]; batch text[]; offset_index integer; key text; legacy jsonb; purge_operation_id uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM companies c WHERE c.id=company) THEN RETURN; END IF;
 SELECT operation.id INTO purge_operation_id
 FROM company_deletion_operations operation
 JOIN companies owner ON owner.id=operation.company_id
 WHERE operation.company_id=company AND operation.stage='purge' AND operation.status='processing'
   AND operation.evidence->>'runtimesErasedAt' IS NOT NULL
   AND owner.content_erasure_transaction_id=pg_current_xact_id()::text
   AND EXISTS(SELECT 1 FROM heartbeat_runs h WHERE h.company_id=company AND h.id=execution
     AND h.runtime_mode='native' AND h.driver_kind='opencode_server')
 ORDER BY operation.created_at DESC,operation.id DESC LIMIT 1;

 SELECT coalesce(array_agg(DISTINCT r->>'digest' ORDER BY r->>'digest'),ARRAY[]::text[]) INTO refs
 FROM (
  SELECT profile #> '{nativeExecutionInput,runtimeContext,instructions,bundle}' r
  UNION ALL SELECT s->'bundle' FROM jsonb_array_elements(CASE
   WHEN jsonb_typeof(profile #> '{nativeExecutionInput,runtimeContext,skills}')='array'
   THEN profile #> '{nativeExecutionInput,runtimeContext,skills}' ELSE '[]'::jsonb END) s
 ) assets WHERE r->>'digest' ~ '^[a-f0-9]{64}$'
  AND r->>'rootPath' ~ ('/runtime-context-assets/bundles/'||(r->>'digest')||'$');

 -- Require the exact succeeded provider-home base receipt and digest-suffixed
 -- batches whose union covers every current legacy profile reference.
 IF purge_operation_id IS NOT NULL AND EXISTS(
  SELECT 1 FROM memory_jobs j
  WHERE j.company_id=company AND j.operation_type='retention'
    AND j.job_key='runtime-asset-erasure:v1:'||execution::text
    AND j.attempt_number=(SELECT max(latest.attempt_number) FROM memory_jobs latest
      WHERE latest.company_id=company AND latest.job_key=j.job_key)
    AND j.status='succeeded'
    AND j.source_ref_json->>'kind'='runtime_asset_erasure'
    AND j.source_ref_json->>'runId'=execution::text
    AND j.source_ref_json->>'companyPurgeOperationId'=purge_operation_id::text
    AND jsonb_typeof(j.source_ref_json->'legacyDigests')='array'
    AND j.source_ref_json->'legacyDigests'='[]'::jsonb
 ) AND NOT EXISTS(
  SELECT 1 FROM unnest(refs) required(digest)
  WHERE NOT EXISTS(
   SELECT 1 FROM memory_jobs batch
   WHERE batch.company_id=company AND batch.operation_type='retention' AND batch.status='succeeded'
     AND batch.attempt_number=(SELECT max(latest.attempt_number) FROM memory_jobs latest
       WHERE latest.company_id=company AND latest.job_key=batch.job_key)
     AND batch.source_ref_json->>'kind'='runtime_asset_erasure'
     AND batch.source_ref_json->>'runId'=execution::text
     AND batch.source_ref_json->>'companyPurgeOperationId'=purge_operation_id::text
     AND jsonb_typeof(batch.source_ref_json->'legacyDigests')='array'
     AND (CASE WHEN jsonb_typeof(batch.source_ref_json->'legacyDigests')='array'
       THEN jsonb_array_length(batch.source_ref_json->'legacyDigests') ELSE 0 END) BETWEEN 1 AND 256
     AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(batch.source_ref_json->'legacyDigests')='array'
       THEN batch.source_ref_json->'legacyDigests' ELSE '[]'::jsonb END) AS item(value)
       WHERE item.value !~ '^[a-f0-9]{64}$')
     AND batch.source_ref_json->'legacyDigests' @> jsonb_build_array(required.digest)
     AND batch.job_key='runtime-asset-erasure:v1:'||execution::text||':'||encode(sha256(convert_to(array_to_string(
       ARRAY(SELECT DISTINCT item.value FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(batch.source_ref_json->'legacyDigests')='array'
         THEN batch.source_ref_json->'legacyDigests' ELSE '[]'::jsonb END) AS item(value) ORDER BY item.value),','),'UTF8')),'hex')
  )
 ) THEN RETURN; END IF;

 -- Each original outbox job is bounded; references outside a complete base
 -- receipt are queued and the caller's final purge assertion must block delete.
 FOR offset_index IN 0..greatest(0,(cardinality(refs)-1)/256) LOOP
  batch:=refs[offset_index*256+1:offset_index*256+256];legacy:=to_jsonb(coalesce(batch,ARRAY[]::text[]));
  key:='runtime-asset-erasure:v1:'||execution::text;
  IF cardinality(batch)>0 THEN key:=key||':'||encode(sha256(convert_to(array_to_string(batch,','),'UTF8')),'hex'); END IF;
  INSERT INTO memory_jobs(company_id,operation_type,job_key,source_ref_json)
   VALUES(company,'retention',key,jsonb_build_object('kind','runtime_asset_erasure','runId',execution::text,'legacyDigests',legacy) ||
     CASE WHEN purge_operation_id IS NOT NULL THEN jsonb_build_object('companyPurgeOperationId',purge_operation_id::text) ELSE '{}'::jsonb END)
   ON CONFLICT(company_id,job_key,attempt_number) DO UPDATE
   SET source_ref_json=EXCLUDED.source_ref_json,
       status='queued',finished_at=NULL,result_json=NULL,result_summary=NULL,error=NULL,error_code=NULL,updated_at=now()
   WHERE (memory_jobs.status IN('succeeded','failed','cancelled') OR
     (memory_jobs.status='queued' AND purge_operation_id IS NOT NULL))
     AND (
       purge_operation_id IS NOT NULL AND memory_jobs.status='succeeded'
       AND memory_jobs.operation_type='retention'
       AND memory_jobs.source_ref_json->>'kind'='runtime_asset_erasure'
       AND memory_jobs.source_ref_json->>'runId'=execution::text
       AND memory_jobs.source_ref_json->>'companyPurgeOperationId'=purge_operation_id::text
       AND jsonb_typeof(memory_jobs.source_ref_json->'legacyDigests')='array'
       AND (EXCLUDED.source_ref_json->'legacyDigests') <@ (memory_jobs.source_ref_json->'legacyDigests')
     ) IS NOT TRUE;
 END LOOP;
END $$;
