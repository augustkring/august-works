CREATE INDEX "company_transfer_runs_resource_active_idx" ON "company_transfer_runs" USING btree ("company_id","id") WHERE "company_transfer_runs"."direction"='export' and ("company_transfer_runs"."status"='running' or "company_transfer_runs"."container_ref" #>> '{artifact,state}'='allocated');
--> statement-breakpoint
-- Candidate function replacements only; not an applied migration or journal entry.
-- Keep the complete 0577 occupancy function body and the 0564 shared admission owner.
CREATE OR REPLACE FUNCTION public.aw_v10_resource_durable_occupancy(target_company uuid DEFAULT NULL)
RETURNS bigint LANGUAGE sql VOLATILE AS $$
 WITH run_candidates AS (
  SELECT company_id,id FROM heartbeat_runs WHERE status='running'
   AND (target_company IS NULL OR company_id=target_company)
  UNION SELECT company_id,id FROM heartbeat_runs WHERE runner_profile_json->>'nativeWorkspaceFinalizationOwner' IS NOT NULL
   AND (target_company IS NULL OR company_id=target_company)
  UNION SELECT company_id,id FROM heartbeat_runs WHERE
   (native_process_cleanup_pending IS TRUE OR (native_process_cleanup_pending IS NULL AND runtime_mode='native'
    AND (status<>'queued' OR started_at IS NOT NULL OR process_started_at IS NOT NULL OR process_pid IS NOT NULL
     OR process_group_id IS NOT NULL OR native_phase IS NOT NULL OR session_id_after IS NOT NULL)
    AND NOT public.aw_v10_native_prelaunch_container_cleanup_completed(company_id,id)))
   AND (target_company IS NULL OR company_id=target_company)
  UNION SELECT company_id,run_id FROM native_run_finalizations WHERE
   (lease_owner IS NOT NULL OR phase NOT IN ('committed','applied','terminal_failure')) AND (target_company IS NULL OR company_id=target_company)
 ), lease_candidates AS (
  SELECT l AS lease,h.runtime_mode FROM environment_leases l LEFT JOIN heartbeat_runs h ON h.id=l.heartbeat_run_id AND h.company_id=l.company_id
  WHERE (not coalesce(((l.status in ('released','expired','failed') and l.released_at is not null and
        (l.cleanup_status='success' or (l.cleanup_status is null and
          ((l.provider='local' and l.provider_lease_id is null) or
           (l.provider='ssh' and l.metadata->>'driver'='ssh' and l.provider_lease_id like 'ssh://%')))))
        or (l.status='retained' and l.lease_policy='reuse_by_environment' and l.cleanup_status='success')),false)
        or coalesce(l.metadata->>'pendingCleanupInFlight','false')<>'false') AND (target_company IS NULL OR l.company_id=target_company)
 ), occupied AS (
  SELECT r.company_id,'heartbeat:'||r.id::text AS owner FROM run_candidates r LEFT JOIN heartbeat_runs h ON h.company_id=r.company_id AND h.id=r.id
  WHERE h.id IS NULL OR h.status='running' OR h.native_process_cleanup_pending IS TRUE
   OR (h.native_process_cleanup_pending IS NULL AND h.runtime_mode='native'
    AND (h.status<>'queued' OR h.started_at IS NOT NULL OR h.process_started_at IS NOT NULL OR h.process_pid IS NOT NULL
     OR h.process_group_id IS NOT NULL OR h.native_phase IS NOT NULL OR h.session_id_after IS NOT NULL)
    AND NOT public.aw_v10_native_prelaunch_container_cleanup_completed(h.company_id,h.id))
   OR public.aw_v10_run_cleanup_pending(h)
  UNION SELECT (l.lease).company_id,CASE WHEN (l.lease).heartbeat_run_id IS NOT NULL THEN 'heartbeat:'||(l.lease).heartbeat_run_id::text
   WHEN (l.lease).metadata->>'_nativeHeartbeatRunId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN 'heartbeat:'||lower((l.lease).metadata->>'_nativeHeartbeatRunId') ELSE 'lease:'||(l.lease).id::text END
  FROM lease_candidates l WHERE public.aw_v10_pending_environment_cleanup(
   l.lease,coalesce(l.runtime_mode='native',true))
  UNION ALL SELECT company_id,'workflow:'||id::text FROM workflow_runs WHERE status IN ('running','recovering','cancelling')
   AND (target_company IS NULL OR company_id=target_company)
  UNION ALL SELECT company_id,'memory:'||id::text FROM memory_jobs WHERE status='running'
   AND (target_company IS NULL OR company_id=target_company)
  UNION ALL SELECT company_id,'company_export:'||id::text FROM company_transfer_runs
   WHERE direction='export' AND (status='running' OR container_ref #>> '{artifact,state}'='allocated')
    AND (target_company IS NULL OR company_id=target_company)
 ) SELECT count(*) FROM occupied
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.aw_v10_resource_durable_admission() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE policy jsonb; pool jsonb; company_rule jsonb; occupied bigint; hard_limit bigint;
BEGIN
 -- Renewal/replay, terminal cleanup, erasure and Stop are not positive work admission.
 -- Imports use the original import owner; only export runs enter this shared durable pool.
 IF TG_TABLE_NAME='company_transfer_runs' THEN
  IF NEW.direction IS DISTINCT FROM 'export' OR NEW.status<>'running'
    OR (TG_OP='UPDATE' AND OLD.direction='export' AND OLD.status='running' AND OLD.company_id=NEW.company_id) THEN RETURN NEW; END IF;
 ELSE
  IF NEW.status<>'running' OR (TG_OP='UPDATE' AND OLD.status IN ('running','recovering') AND OLD.company_id=NEW.company_id) THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='memory_jobs' THEN
   IF NEW.operation_type='retention' THEN RETURN NEW; END IF;
  END IF;
 END IF;
 SELECT general->'resourceGovernance' INTO policy FROM instance_settings WHERE singleton_key='default' FOR SHARE;
 IF policy IS NULL THEN RETURN NEW; END IF;
 IF NOT public.aw_v10_resource_policy_valid(policy) THEN RAISE EXCEPTION 'resource_policy_invalid' USING ERRCODE='23514'; END IF;
 IF jsonb_typeof(policy) IS DISTINCT FROM 'object' OR policy->>'version' IS DISTINCT FROM '1' OR jsonb_typeof(policy->'pools') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'resource_policy_invalid' USING ERRCODE='23514'; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(policy->'pools') p WHERE p->>'resource'='durable_execution')>1 THEN
  RAISE EXCEPTION 'resource_policy_invalid' USING ERRCODE='23514'; END IF;
 SELECT p INTO pool FROM jsonb_array_elements(policy->'pools') p WHERE p->>'resource'='durable_execution';
 IF pool IS NULL THEN RETURN NEW; END IF;
 IF pool->>'unit' IS DISTINCT FROM 'active_work_item' OR pool->>'onHardLimit' IS DISTINCT FROM 'defer' OR pool->>'onSoftLimit' IS DISTINCT FROM 'observe'
  OR coalesce(pool->>'exceptionOwner','')='' OR jsonb_typeof(pool->'companies') IS DISTINCT FROM 'array'
  OR jsonb_typeof(pool->'hardLimit') IS DISTINCT FROM 'number' OR coalesce(pool->>'hardLimit','') !~ '^[1-9][0-9]{0,9}([.]0+)?$' OR (pool->>'hardLimit')::numeric::bigint>2147483647 THEN
  RAISE EXCEPTION 'resource_policy_invalid' USING ERRCODE='23514'; END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'resource_admission_requires_read_committed' USING ERRCODE='23514'; END IF;
 -- All original owners serialize the final admission and original row CAS.
 -- Do not wait while holding original row/privacy locks: contention defers
 -- the original row, avoiding an owner-row/global-fence inversion. Volatile
 -- occupancy reads use the current READ COMMITTED snapshot.
 IF NOT pg_try_advisory_xact_lock(740020,1) THEN
  RAISE EXCEPTION 'resource_durable_execution_deferred' USING ERRCODE='P0001';
 END IF;
 hard_limit := (pool->>'hardLimit')::numeric::bigint;
 occupied := public.aw_v10_resource_durable_occupancy(NULL);
 IF occupied>=hard_limit THEN RAISE EXCEPTION 'resource_durable_execution_deferred' USING ERRCODE='P0001'; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(pool->'companies') c WHERE lower(c->>'companyId')=NEW.company_id::text)>1 THEN
  RAISE EXCEPTION 'resource_policy_invalid' USING ERRCODE='23514'; END IF;
 SELECT c INTO company_rule FROM jsonb_array_elements(pool->'companies') c WHERE lower(c->>'companyId')=NEW.company_id::text;
 IF company_rule IS NOT NULL THEN
  IF jsonb_typeof(company_rule->'hardLimit') IS DISTINCT FROM 'number' OR coalesce(company_rule->>'hardLimit','') !~ '^[1-9][0-9]{0,9}([.]0+)?$' OR (company_rule->>'hardLimit')::numeric::bigint>2147483647 THEN
   RAISE EXCEPTION 'resource_policy_invalid' USING ERRCODE='23514'; END IF;
  IF public.aw_v10_resource_durable_occupancy(NEW.company_id)>=(company_rule->>'hardLimit')::numeric::bigint THEN
   RAISE EXCEPTION 'resource_durable_execution_deferred' USING ERRCODE='P0001'; END IF;
 END IF;
 IF pool ? 'softLimit' THEN
  IF jsonb_typeof(pool->'softLimit') IS DISTINCT FROM 'number' OR coalesce(pool->>'softLimit','') !~ '^[1-9][0-9]{0,9}([.]0+)?$'
   OR (pool->>'softLimit')::numeric::bigint>hard_limit THEN RAISE EXCEPTION 'resource_policy_invalid' USING ERRCODE='23514'; END IF;
  IF occupied+1>=(pool->>'softLimit')::numeric::bigint THEN
   INSERT INTO activity_log(company_id,actor_type,actor_id,action,entity_type,entity_id,details)
   VALUES(NEW.company_id,'system','resource-governance','resource.admission_soft_limit',TG_TABLE_NAME,NEW.id::text,
    jsonb_build_object('resource','durable_execution','unit','active_work_item'));
  END IF;
 END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER aw_v10_resource_company_transfer_admission
 BEFORE INSERT OR UPDATE ON public.company_transfer_runs
 FOR EACH ROW EXECUTE FUNCTION public.aw_v10_resource_durable_admission();
