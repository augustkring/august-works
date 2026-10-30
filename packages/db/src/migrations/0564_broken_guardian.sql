-- Bounded Resource governance cutover; drain Native heartbeat/event writers. Any failure rolls the whole migration back without a journal row.
SET LOCAL lock_timeout='5s';
--> statement-breakpoint
SET LOCAL statement_timeout='30s';
--> statement-breakpoint
LOCK TABLE heartbeat_runs IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
LOCK TABLE heartbeat_run_events IN SHARE ROW EXCLUSIVE MODE NOWAIT;
--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ADD COLUMN "native_process_cleanup_pending" boolean;--> statement-breakpoint
CREATE INDEX "environment_leases_resource_cleanup_idx" ON "environment_leases" USING btree ("company_id","heartbeat_run_id","id") WHERE not coalesce((("environment_leases"."status" in ('released','expired','failed') and "environment_leases"."released_at" is not null and
        ("environment_leases"."cleanup_status"='success' or ("environment_leases"."cleanup_status" is null and
          (("environment_leases"."provider"='local' and "environment_leases"."provider_lease_id" is null) or
           ("environment_leases"."provider"='ssh' and "environment_leases"."metadata"->>'driver'='ssh' and "environment_leases"."provider_lease_id" like 'ssh://%')))))
        or ("environment_leases"."status"='retained' and "environment_leases"."lease_policy"='reuse_by_environment' and "environment_leases"."cleanup_status"='success')),false)
        or coalesce("environment_leases"."metadata"->>'pendingCleanupInFlight','false')<>'false';--> statement-breakpoint
CREATE INDEX "heartbeat_runs_resource_local_cleanup_idx" ON "heartbeat_runs" USING btree ("company_id","id") WHERE "heartbeat_runs"."native_process_cleanup_pending" is true or ("heartbeat_runs"."native_process_cleanup_pending" is null and "heartbeat_runs"."runtime_mode"='native'
        and ("heartbeat_runs"."status"<>'queued' or "heartbeat_runs"."started_at" is not null or "heartbeat_runs"."process_started_at" is not null
          or "heartbeat_runs"."process_pid" is not null or "heartbeat_runs"."process_group_id" is not null or "heartbeat_runs"."native_phase" is not null
          or "heartbeat_runs"."session_id_after" is not null));--> statement-breakpoint
CREATE INDEX "heartbeat_runs_resource_workspace_cleanup_idx" ON "heartbeat_runs" USING btree ("company_id","id") WHERE "heartbeat_runs"."runner_profile_json"->>'nativeWorkspaceFinalizationOwner' is not null;--> statement-breakpoint
CREATE INDEX "memory_jobs_resource_active_idx" ON "memory_jobs" USING btree ("company_id","id") WHERE "memory_jobs"."status"='running';--> statement-breakpoint
CREATE INDEX "memory_jobs_resource_queued_idx" ON "memory_jobs" USING btree ("company_id","submitted_at","created_at","id") WHERE "memory_jobs"."status"='queued';--> statement-breakpoint
CREATE INDEX "memory_jobs_resource_progress_idx" ON "memory_jobs" USING btree ("company_id","updated_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "memory_jobs"."started_at" is not null;--> statement-breakpoint
CREATE INDEX "native_run_finalizations_resource_cleanup_idx" ON "native_run_finalizations" USING btree ("company_id","run_id") WHERE "native_run_finalizations"."lease_owner" is not null or "native_run_finalizations"."phase" not in ('committed','applied','terminal_failure');--> statement-breakpoint
CREATE INDEX "workflow_runs_resource_active_idx" ON "workflow_runs" USING btree ("company_id","id") WHERE "workflow_runs"."status" in ('running','recovering','cancelling');--> statement-breakpoint
CREATE INDEX "workflow_runs_resource_queued_idx" ON "workflow_runs" USING btree ("company_id","updated_at","id") WHERE "workflow_runs"."status"='queued';--> statement-breakpoint
CREATE INDEX "workflow_runs_resource_progress_idx" ON "workflow_runs" USING btree ("company_id","updated_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "workflow_runs"."started_at" is not null;
--> statement-breakpoint
CREATE FUNCTION public.aw_v10_resource_policy_valid(p jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v jsonb; c jsonb; seen text[] := '{}'; companies text[]; resource text;
BEGIN
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p->'version' IS DISTINCT FROM '1'::jsonb
  OR jsonb_typeof(p->'pools') IS DISTINCT FROM 'array' OR jsonb_typeof(p->'rates') IS DISTINCT FROM 'array'
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN ('version','pools','rates')) THEN RETURN false; END IF;
 IF jsonb_array_length(p->'pools')>2 OR jsonb_array_length(p->'rates')>10000 THEN RETURN false; END IF;
 FOR v IN SELECT * FROM jsonb_array_elements(p->'pools') LOOP
  IF jsonb_typeof(v) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  resource:=v->>'resource';
  IF resource IS NULL OR resource NOT IN ('durable_execution','analytical_request') OR resource=ANY(seen) THEN RETURN false; END IF;
  seen:=array_append(seen,resource);
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(v) k WHERE k NOT IN
   ('resource','unit','hardLimit','softLimit','onSoftLimit','onHardLimit','exceptionOwner','companies'))
   OR v->>'unit' IS DISTINCT FROM (CASE WHEN resource='durable_execution' THEN 'active_work_item' ELSE 'admitted_request' END)
   OR v->>'onHardLimit' IS DISTINCT FROM (CASE WHEN resource='durable_execution' THEN 'defer' ELSE 'reject' END)
   OR v->>'onSoftLimit' IS DISTINCT FROM 'observe' OR jsonb_typeof(v->'exceptionOwner') IS DISTINCT FROM 'string'
   OR length(btrim(v->>'exceptionOwner')) NOT BETWEEN 1 AND 200
   OR jsonb_typeof(v->'hardLimit') IS DISTINCT FROM 'number' OR coalesce(v->>'hardLimit','') !~ '^[1-9][0-9]{0,9}([.]0+)?$'
   OR (v->>'hardLimit')::numeric::bigint>2147483647 OR jsonb_typeof(v->'companies') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF v ? 'softLimit' THEN
   IF jsonb_typeof(v->'softLimit') IS DISTINCT FROM 'number' OR coalesce(v->>'softLimit','') !~ '^[1-9][0-9]{0,9}([.]0+)?$'
    OR (v->>'softLimit')::numeric::bigint>(v->>'hardLimit')::numeric::bigint THEN RETURN false; END IF;
  END IF;
  IF jsonb_array_length(v->'companies')>10000 THEN RETURN false; END IF;
  companies:='{}';
  FOR c IN SELECT * FROM jsonb_array_elements(v->'companies') LOOP
   IF jsonb_typeof(c) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
   IF EXISTS(SELECT 1 FROM jsonb_object_keys(c) k WHERE k NOT IN ('companyId','hardLimit','fairnessClass','priority'))
    OR jsonb_typeof(c->'companyId') IS DISTINCT FROM 'string' OR coalesce(c->>'companyId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR lower(c->>'companyId')=ANY(companies) OR jsonb_typeof(c->'hardLimit') IS DISTINCT FROM 'number'
    OR coalesce(c->>'hardLimit','') !~ '^[1-9][0-9]{0,9}([.]0+)?$' OR (c->>'hardLimit')::numeric::bigint>2147483647
    OR jsonb_typeof(c->'fairnessClass') IS DISTINCT FROM 'string' OR length(btrim(c->>'fairnessClass')) NOT BETWEEN 1 AND 80
    OR jsonb_typeof(c->'priority') IS DISTINCT FROM 'number' OR coalesce(c->>'priority','') !~ '^-?[0-9]{1,10}([.]0+)?$'
    OR (c->>'priority')::numeric::bigint NOT BETWEEN -2147483648 AND 2147483647 THEN RETURN false; END IF;
   companies:=array_append(companies,lower(c->>'companyId'));
  END LOOP;
 END LOOP;
 companies:='{}';
 FOR c IN SELECT * FROM jsonb_array_elements(p->'rates') LOOP
  IF jsonb_typeof(c) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(c) k WHERE k NOT IN
   ('resource','scope','companyId','hardLimit','burst','windowMs','onHardLimit','exceptionOwner'))
   OR c->>'resource' IS DISTINCT FROM 'gateway_request' OR c->>'scope' IS DISTINCT FROM 'company'
   OR c->>'onHardLimit' IS DISTINCT FROM 'reject' OR jsonb_typeof(c->'exceptionOwner') IS DISTINCT FROM 'string'
   OR length(btrim(c->>'exceptionOwner')) NOT BETWEEN 1 AND 200
   OR jsonb_typeof(c->'companyId') IS DISTINCT FROM 'string' OR coalesce(c->>'companyId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   OR lower(c->>'companyId')=ANY(companies)
   OR jsonb_typeof(c->'hardLimit') IS DISTINCT FROM 'number' OR coalesce(c->>'hardLimit','') !~ '^[1-9][0-9]{0,9}([.]0+)?$'
   OR jsonb_typeof(c->'burst') IS DISTINCT FROM 'number' OR coalesce(c->>'burst','') !~ '^[0-9]{1,10}([.]0+)?$'
   OR (c->>'hardLimit')::numeric::bigint+(c->>'burst')::numeric::bigint>2147483647
   OR jsonb_typeof(c->'windowMs') IS DISTINCT FROM 'number' OR coalesce(c->>'windowMs','') !~ '^[1-9][0-9]{0,9}([.]0+)?$'
   OR (c->>'windowMs')::numeric::bigint>2147483647 THEN RETURN false; END IF;
  companies:=array_append(companies,lower(c->>'companyId'));
 END LOOP;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END; $$;
--> statement-breakpoint
-- SAME original execution-blocker owner. Resource admission reuses these
-- current facts; lease expiry alone is never a successful cleanup receipt.
CREATE FUNCTION public.aw_v10_pending_environment_cleanup(l environment_leases, is_native boolean)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT
 (((l).released_at IS NULL AND NOT COALESCE((l).status='retained' AND (l).lease_policy='reuse_by_environment' AND (l).cleanup_status='success',false))
 OR (l).status IN ('active','pending_cleanup') OR (l).cleanup_status='failed'
 OR COALESCE((l).metadata->>'pendingCleanupInFlight','false')<>'false'
 OR (is_native AND NOT COALESCE(
  ((l).status IN ('released','expired','failed') AND (l).released_at IS NOT NULL AND ((l).cleanup_status='success'
    OR ((l).cleanup_status IS NULL AND (((l).provider='local' AND (l).provider_lease_id IS NULL)
      OR ((l).provider='ssh' AND (l).metadata->>'driver'='ssh' AND (l).provider_lease_id LIKE 'ssh://%')))))
  OR ((l).status='retained' AND (l).lease_policy='reuse_by_environment' AND (l).cleanup_status='success'),false)))
$$;
--> statement-breakpoint
CREATE FUNCTION public.aw_v10_run_cleanup_pending(h heartbeat_runs) RETURNS boolean LANGUAGE sql VOLATILE AS $$ SELECT
 (h).runner_profile_json->>'nativeWorkspaceFinalizationOwner' IS NOT NULL
 OR EXISTS(SELECT 1 FROM environment_leases l WHERE l.company_id=(h).company_id AND l.heartbeat_run_id=(h).id
  AND public.aw_v10_pending_environment_cleanup(l,(h).runtime_mode='native'))
 OR EXISTS(SELECT 1 FROM native_run_finalizations f WHERE f.company_id=(h).company_id AND f.run_id=(h).id
  AND (f.lease_owner IS NOT NULL OR f.phase NOT IN ('committed','applied','terminal_failure')))
$$;
--> statement-breakpoint
CREATE FUNCTION public.aw_v10_has_pending_run_cleanup(target_company uuid,target_run uuid)
RETURNS boolean LANGUAGE sql VOLATILE AS $$ SELECT COALESCE((SELECT public.aw_v10_run_cleanup_pending(h)
 FROM heartbeat_runs h WHERE h.company_id=target_company AND h.id=target_run LIMIT 1),true) $$;
--> statement-breakpoint
-- One migration-only pass of the original indexed server event stream. The
-- generated 0564 preamble acquires bounded heartbeat/event cutover locks before
-- any DDL. Its NOWAIT event lock aborts and rolls back if an in-flight event
-- writer could otherwise create a heartbeat-FK lock cycle. Drain Native
-- heartbeat start/event writers before applying. If either lock or the 30s
-- backfill budget is exceeded, no DDL or journal entry persists; resolve
-- blockers, then retry this same generated migration.
WITH latest AS (SELECT DISTINCT ON (run_id) run_id,company_id,agent_id,event_type FROM heartbeat_run_events
 WHERE source_event_id IS NULL AND event_type IN
  ('native.process_start_requested','native.process_identity_recorded','native.local_process_stopped') ORDER BY run_id,seq DESC)
UPDATE heartbeat_runs h SET native_process_cleanup_pending=(e.event_type<>'native.local_process_stopped')
FROM latest e WHERE h.id=e.run_id AND h.company_id=e.company_id AND h.agent_id=e.agent_id;
--> statement-breakpoint
CREATE FUNCTION public.aw_v10_native_process_cleanup_projection() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event_id bigint; event_kind text; event_xmin xid;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.native_process_cleanup_pending IS NOT NULL THEN RAISE EXCEPTION 'native_process_cleanup_projection_requires_original_event' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.native_process_cleanup_pending IS NOT DISTINCT FROM OLD.native_process_cleanup_pending THEN RETURN NEW; END IF;
 SELECT id,event_type,xmin INTO event_id,event_kind,event_xmin FROM heartbeat_run_events WHERE company_id=NEW.company_id AND run_id=NEW.id AND agent_id=NEW.agent_id
  AND source_event_id IS NULL AND event_type IN
   ('native.process_start_requested','native.process_identity_recorded','native.local_process_stopped') ORDER BY seq DESC LIMIT 1;
 IF event_id IS NULL OR NOT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='transactionid' AND transactionid=event_xmin
    AND pid=pg_backend_pid() AND mode='ExclusiveLock' AND granted)
  OR NEW.native_process_cleanup_pending IS DISTINCT FROM (event_kind<>'native.local_process_stopped') THEN
  RAISE EXCEPTION 'native_process_cleanup_projection_requires_original_event' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER aw_v10_native_process_cleanup_projection BEFORE INSERT OR UPDATE ON heartbeat_runs
FOR EACH ROW EXECUTE FUNCTION public.aw_v10_native_process_cleanup_projection();
--> statement-breakpoint
CREATE FUNCTION public.aw_v10_append_native_process_cleanup_projection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.source_event_id IS NOT NULL OR NEW.event_type NOT IN
  ('native.process_start_requested','native.process_identity_recorded','native.local_process_stopped') THEN RETURN NEW; END IF;
 IF EXISTS(SELECT 1 FROM heartbeat_run_events e WHERE e.run_id=NEW.run_id AND e.company_id=NEW.company_id
  AND e.source_event_id IS NULL AND e.seq>NEW.seq AND e.event_type IN
   ('native.process_start_requested','native.process_identity_recorded','native.local_process_stopped')) THEN RETURN NEW; END IF;
 UPDATE heartbeat_runs SET native_process_cleanup_pending=(NEW.event_type<>'native.local_process_stopped')
 WHERE id=NEW.run_id AND company_id=NEW.company_id AND agent_id=NEW.agent_id;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER aw_v10_append_native_process_cleanup_projection AFTER INSERT ON heartbeat_run_events
FOR EACH ROW EXECUTE FUNCTION public.aw_v10_append_native_process_cleanup_projection();
--> statement-breakpoint
-- Admission reads indexed CURRENT liability candidates, never historical events.
CREATE FUNCTION public.aw_v10_resource_durable_occupancy(target_company uuid DEFAULT NULL)
RETURNS bigint LANGUAGE sql VOLATILE AS $$
 WITH run_candidates AS (
  SELECT company_id,id FROM heartbeat_runs WHERE status='running'
   AND (target_company IS NULL OR company_id=target_company)
  UNION SELECT company_id,id FROM heartbeat_runs WHERE runner_profile_json->>'nativeWorkspaceFinalizationOwner' IS NOT NULL
   AND (target_company IS NULL OR company_id=target_company)
  UNION SELECT company_id,id FROM heartbeat_runs WHERE
   (native_process_cleanup_pending IS TRUE OR (native_process_cleanup_pending IS NULL AND runtime_mode='native'
    AND (status<>'queued' OR started_at IS NOT NULL OR process_started_at IS NOT NULL OR process_pid IS NOT NULL
     OR process_group_id IS NOT NULL OR native_phase IS NOT NULL OR session_id_after IS NOT NULL)))
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
     OR h.process_group_id IS NOT NULL OR h.native_phase IS NOT NULL OR h.session_id_after IS NOT NULL))
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
 ) SELECT count(*) FROM occupied
$$;
--> statement-breakpoint
CREATE FUNCTION public.aw_v10_resource_durable_admission() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE policy jsonb; pool jsonb; company_rule jsonb; occupied bigint; hard_limit bigint;
BEGIN
 -- Renewal/replay, terminal cleanup, erasure and Stop are not positive work admission.
 IF NEW.status<>'running' OR (TG_OP='UPDATE' AND OLD.status IN ('running','recovering') AND OLD.company_id=NEW.company_id) THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='memory_jobs' THEN
  IF NEW.operation_type='retention' THEN RETURN NEW; END IF;
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
 -- All three ORIGINAL owners serialize the final admission and original row CAS.
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
CREATE TRIGGER aw_v10_resource_heartbeat_admission BEFORE INSERT OR UPDATE ON heartbeat_runs FOR EACH ROW EXECUTE FUNCTION public.aw_v10_resource_durable_admission();
--> statement-breakpoint
CREATE TRIGGER aw_v10_resource_workflow_admission BEFORE INSERT OR UPDATE ON workflow_runs FOR EACH ROW EXECUTE FUNCTION public.aw_v10_resource_durable_admission();
--> statement-breakpoint
CREATE TRIGGER aw_v10_resource_memory_admission BEFORE INSERT OR UPDATE ON memory_jobs FOR EACH ROW EXECUTE FUNCTION public.aw_v10_resource_durable_admission();
