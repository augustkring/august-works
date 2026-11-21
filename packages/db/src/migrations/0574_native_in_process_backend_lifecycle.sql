-- Extend the existing original-event projection only. No historical rewrite.
CREATE OR REPLACE FUNCTION public.aw_v10_native_process_cleanup_projection() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event_id bigint; event_kind text; event_xmin xid; event_payload jsonb; event_seq bigint; latest_process_kind text;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.native_process_cleanup_pending IS NOT NULL THEN RAISE EXCEPTION 'native_process_cleanup_projection_requires_original_event' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.native_process_cleanup_pending IS NOT DISTINCT FROM OLD.native_process_cleanup_pending THEN RETURN NEW; END IF;
 SELECT id,event_type,xmin,payload,seq INTO event_id,event_kind,event_xmin,event_payload,event_seq FROM heartbeat_run_events WHERE company_id=NEW.company_id AND run_id=NEW.id AND agent_id=NEW.agent_id
  AND source_event_id IS NULL AND event_type IN
   ('native.process_start_requested','native.process_identity_recorded','native.local_process_stopped','native.remote_workload_stopped','native.in_process_backend_admitted','native.in_process_backend_settled') ORDER BY seq DESC LIMIT 1;
 IF event_kind='native.in_process_backend_settled' THEN
  IF event_payload->>'admissionEventSeq' !~ '^[1-9][0-9]{0,18}$' OR NOT EXISTS (
   SELECT 1 FROM heartbeat_run_events admitted WHERE admitted.company_id=NEW.company_id AND admitted.run_id=NEW.id
    AND admitted.agent_id=NEW.agent_id AND admitted.source_event_id IS NULL
    AND admitted.event_type='native.in_process_backend_admitted'
    AND admitted.seq::text=event_payload->>'admissionEventSeq' AND admitted.seq<event_seq
    AND NOT EXISTS (SELECT 1 FROM heartbeat_run_events newer WHERE newer.company_id=NEW.company_id
     AND newer.run_id=NEW.id AND newer.agent_id=NEW.agent_id AND newer.source_event_id IS NULL
     AND newer.event_type='native.in_process_backend_admitted' AND newer.seq>admitted.seq AND newer.seq<event_seq)
  ) THEN RAISE EXCEPTION 'native_in_process_settlement_requires_exact_admission' USING ERRCODE='23514'; END IF;
  SELECT event_type INTO latest_process_kind FROM heartbeat_run_events WHERE company_id=NEW.company_id AND run_id=NEW.id AND agent_id=NEW.agent_id
   AND source_event_id IS NULL AND event_type IN ('native.process_start_requested','native.process_identity_recorded','native.local_process_stopped','native.remote_workload_stopped') ORDER BY seq DESC LIMIT 1;
 END IF;
 IF event_id IS NULL OR (event_kind='native.in_process_backend_settled' AND latest_process_kind IN ('native.process_start_requested','native.process_identity_recorded')) OR NOT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='transactionid' AND transactionid=event_xmin
    AND pid=pg_backend_pid() AND mode='ExclusiveLock' AND granted)
  OR NEW.native_process_cleanup_pending IS DISTINCT FROM (event_kind NOT IN ('native.local_process_stopped','native.remote_workload_stopped','native.in_process_backend_settled')) THEN
  RAISE EXCEPTION 'native_process_cleanup_projection_requires_original_event' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.aw_v10_append_native_process_cleanup_projection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.source_event_id IS NOT NULL OR NEW.event_type NOT IN
  ('native.process_start_requested','native.process_identity_recorded','native.local_process_stopped','native.remote_workload_stopped','native.in_process_backend_admitted','native.in_process_backend_settled') THEN RETURN NEW; END IF;
 IF EXISTS(SELECT 1 FROM heartbeat_run_events e WHERE e.run_id=NEW.run_id AND e.company_id=NEW.company_id
  AND e.source_event_id IS NULL AND e.seq>NEW.seq AND e.event_type IN
   ('native.process_start_requested','native.process_identity_recorded','native.local_process_stopped','native.remote_workload_stopped','native.in_process_backend_admitted','native.in_process_backend_settled')) THEN RETURN NEW; END IF;
 IF NEW.event_type='native.in_process_backend_settled' AND (
  NEW.payload->>'admissionEventSeq' !~ '^[1-9][0-9]{0,18}$' OR NOT EXISTS (
   SELECT 1 FROM heartbeat_run_events admitted WHERE admitted.company_id=NEW.company_id AND admitted.run_id=NEW.run_id
    AND admitted.agent_id=NEW.agent_id AND admitted.source_event_id IS NULL
    AND admitted.event_type='native.in_process_backend_admitted'
    AND admitted.seq::text=NEW.payload->>'admissionEventSeq' AND admitted.seq<NEW.seq
    AND NOT EXISTS (SELECT 1 FROM heartbeat_run_events newer WHERE newer.company_id=NEW.company_id
     AND newer.run_id=NEW.run_id AND newer.agent_id=NEW.agent_id AND newer.source_event_id IS NULL
     AND newer.event_type='native.in_process_backend_admitted' AND newer.seq>admitted.seq AND newer.seq<NEW.seq)
  )) THEN RAISE EXCEPTION 'native_in_process_settlement_requires_exact_admission' USING ERRCODE='23514'; END IF;
 IF NEW.event_type='native.in_process_backend_settled' AND (
  SELECT e.event_type FROM heartbeat_run_events e WHERE e.run_id=NEW.run_id AND e.company_id=NEW.company_id AND e.agent_id=NEW.agent_id
   AND e.source_event_id IS NULL AND e.event_type IN ('native.process_start_requested','native.process_identity_recorded','native.local_process_stopped','native.remote_workload_stopped')
   ORDER BY e.seq DESC LIMIT 1) IN ('native.process_start_requested','native.process_identity_recorded') THEN RETURN NEW; END IF;
 UPDATE heartbeat_runs SET native_process_cleanup_pending=(NEW.event_type NOT IN ('native.local_process_stopped','native.remote_workload_stopped','native.in_process_backend_settled'))
 WHERE id=NEW.run_id AND company_id=NEW.company_id AND agent_id=NEW.agent_id;
 RETURN NEW;
END; $$;
