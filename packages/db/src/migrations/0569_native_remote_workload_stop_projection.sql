-- Extend the existing original-event projection only. No historical rewrite.
CREATE OR REPLACE FUNCTION public.aw_v10_native_process_cleanup_projection() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event_id bigint; event_kind text; event_xmin xid;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.native_process_cleanup_pending IS NOT NULL THEN RAISE EXCEPTION 'native_process_cleanup_projection_requires_original_event' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.native_process_cleanup_pending IS NOT DISTINCT FROM OLD.native_process_cleanup_pending THEN RETURN NEW; END IF;
 SELECT id,event_type,xmin INTO event_id,event_kind,event_xmin FROM heartbeat_run_events WHERE company_id=NEW.company_id AND run_id=NEW.id AND agent_id=NEW.agent_id
  AND source_event_id IS NULL AND event_type IN
   ('native.process_start_requested','native.process_identity_recorded','native.local_process_stopped','native.remote_workload_stopped') ORDER BY seq DESC LIMIT 1;
 IF event_id IS NULL OR NOT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='transactionid' AND transactionid=event_xmin
    AND pid=pg_backend_pid() AND mode='ExclusiveLock' AND granted)
  OR NEW.native_process_cleanup_pending IS DISTINCT FROM (event_kind NOT IN ('native.local_process_stopped','native.remote_workload_stopped')) THEN
  RAISE EXCEPTION 'native_process_cleanup_projection_requires_original_event' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.aw_v10_append_native_process_cleanup_projection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.source_event_id IS NOT NULL OR NEW.event_type NOT IN
  ('native.process_start_requested','native.process_identity_recorded','native.local_process_stopped','native.remote_workload_stopped') THEN RETURN NEW; END IF;
 IF EXISTS(SELECT 1 FROM heartbeat_run_events e WHERE e.run_id=NEW.run_id AND e.company_id=NEW.company_id
  AND e.source_event_id IS NULL AND e.seq>NEW.seq AND e.event_type IN
   ('native.process_start_requested','native.process_identity_recorded','native.local_process_stopped','native.remote_workload_stopped')) THEN RETURN NEW; END IF;
 UPDATE heartbeat_runs SET native_process_cleanup_pending=(NEW.event_type NOT IN ('native.local_process_stopped','native.remote_workload_stopped'))
 WHERE id=NEW.run_id AND company_id=NEW.company_id AND agent_id=NEW.agent_id;
 RETURN NEW;
END; $$;
