ALTER TABLE "workflow_runs" ADD COLUMN "authoring_source_workflow_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "workflow_runs_authoring_sources_idx" ON "workflow_runs" USING gin ("authoring_source_workflow_ids");--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_authoring_sources_check" CHECK (jsonb_typeof("workflow_runs"."authoring_source_workflow_ids") = 'array');
--> statement-breakpoint
-- Existing Native child relationships are the copy owner. Backfill exact
-- private roots onto every actual ancestor, without discarding excess refs.
WITH RECURSIVE copies AS (
 SELECT r.company_id,r.id,r.parent_workflow_run_id AS parent_id,r.workflow_id AS source_id,ARRAY[r.id] AS path,1 AS depth
 FROM workflow_runs r JOIN workflows w ON w.company_id=r.company_id AND w.id=r.workflow_id
 WHERE jsonb_array_length(w.authoring_source_run_ids)>0
 UNION ALL
 SELECT c.company_id,p.id,p.parent_workflow_run_id,c.source_id,c.path||p.id,c.depth+1
 FROM copies c JOIN workflow_runs p ON p.company_id=c.company_id AND p.id=c.parent_id
 WHERE c.depth<16 AND NOT p.id=ANY(c.path)
), refs AS (SELECT company_id,id,jsonb_agg(DISTINCT source_id::text) AS sources FROM copies GROUP BY company_id,id)
UPDATE workflow_runs r SET authoring_source_workflow_ids=refs.sources FROM refs WHERE r.company_id=refs.company_id AND r.id=refs.id;
--> statement-breakpoint
CREATE FUNCTION aw_workflow_run_authoring_source_erased(company uuid, execution uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE AS $$
DECLARE root uuid; refs jsonb; ref text;
BEGIN
 IF EXISTS(SELECT 1 FROM memory_deletion_markers m WHERE m.company_id=company AND m.kind='source'
   AND m.key='workflow-run-authoring-source-erasure:v1:'||execution::text) THEN RETURN true; END IF;
 SELECT workflow_id,authoring_source_workflow_ids INTO root,refs FROM workflow_runs WHERE company_id=company AND id=execution;
 IF root IS NULL OR refs IS NULL OR jsonb_typeof(refs)<>'array' THEN RETURN true; END IF;
 IF aw_workflow_authoring_source_erased(company,root) THEN RETURN true; END IF;
 FOR ref IN SELECT jsonb_array_elements_text(refs) LOOP
   IF ref !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR aw_workflow_authoring_source_erased(company,ref::uuid) THEN RETURN true; END IF;
 END LOOP;
 RETURN false;
END $$;
--> statement-breakpoint
CREATE FUNCTION aw_capture_workflow_run_authoring_sources() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid; parent_id uuid; path uuid[]; next_refs jsonb; existing_refs jsonb; depth integer:=0;
BEGIN
 IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM workflows WHERE company_id=NEW.company_id AND id=NEW.workflow_id AND jsonb_array_length(authoring_source_run_ids)>0) THEN
   SELECT coalesce(jsonb_agg(DISTINCT value),'[]'::jsonb) INTO NEW.authoring_source_workflow_ids
     FROM jsonb_array_elements(NEW.authoring_source_workflow_ids||jsonb_build_array(NEW.workflow_id::text));
 END IF;
 IF TG_OP='INSERT' AND NEW.parent_workflow_run_id IS NOT NULL AND jsonb_array_length(NEW.authoring_source_workflow_ids)>0 THEN
   target:=NEW.parent_workflow_run_id; path:=ARRAY[NEW.id];
   WHILE target IS NOT NULL LOOP
     IF depth>=16 OR target=ANY(path) THEN RAISE EXCEPTION 'Complete Native workflow copy ancestry is cyclic or excessive' USING ERRCODE='23514'; END IF;
     SELECT parent_workflow_run_id,authoring_source_workflow_ids INTO parent_id,existing_refs
       FROM workflow_runs WHERE company_id=NEW.company_id AND id=target FOR UPDATE;
     IF existing_refs IS NULL THEN RAISE EXCEPTION 'The actual Native parent run is unavailable' USING ERRCODE='23514'; END IF;
     SELECT coalesce(jsonb_agg(DISTINCT value),'[]'::jsonb) INTO next_refs
       FROM jsonb_array_elements(existing_refs||NEW.authoring_source_workflow_ids);
     IF jsonb_array_length(next_refs)>32 THEN RAISE EXCEPTION 'Complete Native workflow copy review exceeds its admission bound' USING ERRCODE='23514'; END IF;
     PERFORM set_config('aw.workflow_run_source_capture',NEW.company_id::text||':'||target::text,true);
     UPDATE workflow_runs SET authoring_source_workflow_ids=next_refs WHERE company_id=NEW.company_id AND id=target;
     PERFORM set_config('aw.workflow_run_source_capture','',true);
     path:=path||target; target:=parent_id; depth:=depth+1;
   END LOOP;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aaa_capture_workflow_run_authoring_sources BEFORE INSERT OR UPDATE ON workflow_runs
 FOR EACH ROW EXECUTE FUNCTION aw_capture_workflow_run_authoring_sources();
--> statement-breakpoint
CREATE FUNCTION aw_guard_workflow_run_authoring_sources() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE execution uuid; erased boolean;
BEGIN
 IF TG_TABLE_NAME='workflow_runs' THEN
   execution:=NEW.id;
   IF TG_OP='UPDATE' AND NEW.authoring_source_workflow_ids IS DISTINCT FROM OLD.authoring_source_workflow_ids THEN
     IF NOT NEW.authoring_source_workflow_ids @> OLD.authoring_source_workflow_ids
       OR current_setting('aw.workflow_run_source_capture',true) IS DISTINCT FROM NEW.company_id::text||':'||NEW.id::text THEN
       RAISE EXCEPTION 'Native workflow copy provenance cannot be removed or replaced' USING ERRCODE='23514'; END IF;
   END IF;
   -- On INSERT, the row is not yet visible to the run source function.
   IF TG_OP='INSERT' THEN
     SELECT EXISTS(SELECT 1 FROM memory_deletion_markers m WHERE m.company_id=NEW.company_id AND m.kind='source'
       AND m.key='workflow-run-authoring-source-erasure:v1:'||NEW.id::text)
       OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW.authoring_source_workflow_ids) ref(value)
       WHERE aw_workflow_authoring_source_erased(NEW.company_id,ref.value::uuid)) INTO erased;
   ELSE erased:=aw_workflow_run_authoring_source_erased(NEW.company_id,execution); END IF;
 ELSE execution:=NEW.workflow_run_id; erased:=aw_workflow_run_authoring_source_erased(NEW.company_id,execution);
 END IF;
 IF NOT erased THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='workflow_runs' THEN
   NEW.trigger_payload:='{}'::jsonb; NEW.failure_message:=NULL;
   IF NEW.status NOT IN ('succeeded','failed','cancelled') THEN NEW.status:='cancelling'; NEW.finished_at:=NULL; END IF;
   NEW.execution_owner_id:=NULL; NEW.lease_expires_at:=NULL;
 ELSIF TG_TABLE_NAME='workflow_step_runs' THEN
   NEW.input_json:=NULL; NEW.output_json:=NULL; NEW.task_result_json:=NULL; NEW.error_message:=NULL;
   IF NEW.status NOT IN ('succeeded','failed','cancelled','skipped','retried') THEN NEW.status:='cancelling'; NEW.finished_at:=NULL; END IF;
 ELSIF TG_TABLE_NAME='workflow_waits' THEN
   IF TG_OP='UPDATE' THEN
     IF OLD.status IN ('cancelled','timed_out') AND OLD.resolution_json->>'parentCancellation'='true'
       AND OLD.resolution_json->>'errorCode'='workflow_parent_cancelled' THEN NEW.status:=OLD.status; NEW.resolution_json:=OLD.resolution_json; END IF;
   END IF;
   IF NEW.status IN ('cancelled','timed_out') AND NEW.resolution_json->>'parentCancellation'='true'
     AND NEW.resolution_json->>'errorCode'='workflow_parent_cancelled' THEN
     NEW.resolution_json:='{"parentCancellation":true,"errorCode":"workflow_parent_cancelled"}'::jsonb;
   ELSE NEW.resolution_json:=NULL; END IF;
 ELSE NEW.corrected_outputs:='{}'::jsonb; NEW.reason:='Source payload erased';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aac_workflow_run_authoring_sources_guard BEFORE INSERT OR UPDATE ON workflow_runs
 FOR EACH ROW EXECUTE FUNCTION aw_guard_workflow_run_authoring_sources();
--> statement-breakpoint
CREATE TRIGGER aac_workflow_run_authoring_sources_guard BEFORE INSERT OR UPDATE ON workflow_step_runs
 FOR EACH ROW EXECUTE FUNCTION aw_guard_workflow_run_authoring_sources();
--> statement-breakpoint
CREATE TRIGGER aac_workflow_run_authoring_sources_guard BEFORE INSERT OR UPDATE ON workflow_waits
 FOR EACH ROW EXECUTE FUNCTION aw_guard_workflow_run_authoring_sources();
--> statement-breakpoint
CREATE TRIGGER aac_workflow_run_authoring_sources_guard BEFORE INSERT OR UPDATE ON workflow_run_reviews
 FOR EACH ROW EXECUTE FUNCTION aw_guard_workflow_run_authoring_sources();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_workflow_memory_erased(company uuid, execution uuid, task uuid)
RETURNS boolean LANGUAGE sql VOLATILE AS $$
 WITH copy_owners AS MATERIALIZED (
   SELECT DISTINCT w.id FROM workflow_runs w WHERE w.company_id=company AND
     (w.execution_agent_run_id=execution OR EXISTS(SELECT 1 FROM workflow_step_runs s WHERE s.company_id=company
       AND s.workflow_run_id=w.id AND s.heartbeat_run_id=execution)
       OR EXISTS(SELECT 1 FROM issues i WHERE i.company_id=company AND i.id=task
         AND i.origin_kind='workflow_task' AND i.origin_run_id=w.id::text))
 )
 SELECT aw_workflow_memory_erased_before_authoring(company,execution,task)
   OR EXISTS(SELECT 1 FROM copy_owners owner WHERE aw_workflow_run_authoring_source_erased(company,owner.id))
$$;
--> statement-breakpoint
CREATE FUNCTION aw_erase_workflow_run_authoring_sources(company uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE target uuid;
BEGIN
 FOR target IN SELECT id FROM workflow_runs WHERE company_id=company AND aw_workflow_run_authoring_source_erased(company,id) LOOP
   INSERT INTO memory_deletion_markers(company_id,kind,key) VALUES(company,'source','workflow-run-authoring-source-erasure:v1:'||target::text) ON CONFLICT DO NOTHING;
   UPDATE workflow_runs SET trigger_payload='{}'::jsonb,failure_message=NULL WHERE company_id=company AND id=target;
   UPDATE workflow_step_runs SET input_json=NULL,output_json=NULL,task_result_json=NULL,error_message=NULL WHERE company_id=company AND workflow_run_id=target;
   UPDATE workflow_waits SET resolution_json=NULL WHERE company_id=company AND workflow_run_id=target;
   UPDATE workflow_run_reviews SET corrected_outputs='{}'::jsonb,reason='Source payload erased' WHERE company_id=company AND workflow_run_id=target;
   UPDATE activity_log SET details='{"payloadDeleted":true}'::jsonb WHERE company_id=company AND
     ((entity_type='workflow_run' AND entity_id=target::text)
       OR (entity_type='workflow_step_run' AND entity_id IN(SELECT id::text FROM workflow_step_runs WHERE company_id=company AND workflow_run_id=target))
       OR (entity_type='workflow_wait' AND entity_id IN(SELECT id::text FROM workflow_waits WHERE company_id=company AND workflow_run_id=target)));
 END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION aw_guard_workflow_run_authoring_activity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE execution uuid;
BEGIN
 IF NEW.entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
   IF NEW.entity_type='workflow_run' THEN execution:=NEW.entity_id::uuid;
   ELSIF NEW.entity_type='workflow_step_run' THEN SELECT workflow_run_id INTO execution FROM workflow_step_runs WHERE company_id=NEW.company_id AND id=NEW.entity_id::uuid;
   ELSIF NEW.entity_type='workflow_wait' THEN SELECT workflow_run_id INTO execution FROM workflow_waits WHERE company_id=NEW.company_id AND id=NEW.entity_id::uuid; END IF;
 END IF;
 IF execution IS NOT NULL AND aw_workflow_run_authoring_source_erased(NEW.company_id,execution) THEN NEW.details:='{"payloadDeleted":true}'::jsonb; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_workflow_run_authoring_activity_guard BEFORE INSERT OR UPDATE ON activity_log
 FOR EACH ROW EXECUTE FUNCTION aw_guard_workflow_run_authoring_activity();
