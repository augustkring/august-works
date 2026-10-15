ALTER TABLE "workflows" ADD COLUMN "authoring_source_run_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_authoring_sources_check" CHECK (jsonb_typeof("workflows"."authoring_source_run_ids") = 'array');
--> statement-breakpoint
-- Backfill actual Native conversation authoring provenance, including discarded
-- revisions. A later Human edit does not remove its private source dependency.
UPDATE workflows w SET authoring_source_run_ids=s.ids FROM (
 SELECT r.company_id,r.workflow_id,jsonb_agg(DISTINCT h.id::text) AS ids
 FROM workflow_revisions r JOIN heartbeat_runs h ON h.company_id=r.company_id AND h.id=r.created_by_run_id
 JOIN issues i ON i.company_id=h.company_id AND i.id=coalesce(h.native_issue_id,CASE
   WHEN coalesce(h.context_snapshot->>'issueId',h.context_snapshot->>'taskId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   THEN coalesce(h.context_snapshot->>'issueId',h.context_snapshot->>'taskId')::uuid ELSE NULL END)
 WHERE r.created_by_agent_id=h.agent_id AND i.conversation_agent_id=h.agent_id
   AND i.conversation_user_id=h.responsible_user_id
 GROUP BY r.company_id,r.workflow_id
) s WHERE w.company_id=s.company_id AND w.id=s.workflow_id;
--> statement-breakpoint
CREATE FUNCTION aw_workflow_authoring_source_erased(company uuid, workflow uuid, retained jsonb DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql VOLATILE AS $$
DECLARE refs jsonb; ref text; origin heartbeat_runs%ROWTYPE; task_id uuid;
 prior text; depth integer; erased boolean; visited integer; counter text;
BEGIN
 IF EXISTS(SELECT 1 FROM memory_deletion_markers m WHERE m.company_id=company AND m.kind='source'
   AND m.key='workflow-authoring-source-erasure:v1:'||workflow::text) THEN RETURN true; END IF;
 SELECT coalesce(retained,(SELECT authoring_source_run_ids FROM workflows WHERE company_id=company AND id=workflow)) INTO refs;
 IF refs IS NULL OR jsonb_typeof(refs)<>'array' THEN RETURN true; END IF;
 IF jsonb_array_length(refs)=0 THEN RETURN false; END IF;
 prior:=current_setting('aw.workflow_authoring_source_depth',true);
 depth:=CASE WHEN coalesce(prior,'') ~ '^[0-9]{1,3}$' THEN prior::integer ELSE 0 END;
 IF depth>=16 THEN RAISE EXCEPTION 'Complete workflow source review is cyclic or excessive' USING ERRCODE='54001'; END IF;
 counter:=current_setting('aw.workflow_authoring_source_visited',true);
 visited:=CASE WHEN depth=0 OR coalesce(counter,'') !~ '^[0-9]{1,4}$' THEN 0 ELSE counter::integer END;
 IF visited>=256 THEN RAISE EXCEPTION 'Complete workflow source review exceeds its budget' USING ERRCODE='54001'; END IF;
 PERFORM set_config('aw.workflow_authoring_source_visited',(visited+1)::text,true);
 PERFORM set_config('aw.workflow_authoring_source_depth',(depth+1)::text,true);
 erased:=false;
 FOR ref IN SELECT jsonb_array_elements_text(refs) LOOP
   IF ref !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN erased:=true; EXIT; END IF;
   SELECT * INTO origin FROM heartbeat_runs WHERE company_id=company AND id=ref::uuid;
   IF origin.id IS NULL OR origin.responsible_user_id IS NULL THEN erased:=true; EXIT; END IF;
   task_id:=coalesce(origin.native_issue_id,CASE
     WHEN coalesce(origin.context_snapshot->>'issueId',origin.context_snapshot->>'taskId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     THEN coalesce(origin.context_snapshot->>'issueId',origin.context_snapshot->>'taskId')::uuid ELSE NULL END);
   IF NOT EXISTS(SELECT 1 FROM issues i WHERE i.company_id=company AND i.id=task_id
     AND i.conversation_agent_id=origin.agent_id AND i.conversation_user_id=origin.responsible_user_id
     AND i.conversation_retired_at IS NULL) OR aw_workflow_memory_erased(company,origin.id,task_id)
     THEN erased:=true; EXIT; END IF;
 END LOOP;
 PERFORM set_config('aw.workflow_authoring_source_depth',coalesce(prior,''),true);
 IF depth=0 THEN PERFORM set_config('aw.workflow_authoring_source_visited','',true); END IF;
 RETURN erased;
EXCEPTION WHEN OTHERS THEN
 PERFORM set_config('aw.workflow_authoring_source_depth',coalesce(prior,''),true); RAISE;
END $$;
--> statement-breakpoint
CREATE FUNCTION aw_capture_workflow_authoring_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_run uuid;
BEGIN
 IF NEW.created_by_run_id IS NOT NULL AND NEW.created_by_agent_id IS NOT NULL THEN
   SELECT h.id INTO source_run FROM heartbeat_runs h JOIN issues i ON i.company_id=h.company_id
     AND i.id=coalesce(h.native_issue_id,CASE
       WHEN coalesce(h.context_snapshot->>'issueId',h.context_snapshot->>'taskId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       THEN coalesce(h.context_snapshot->>'issueId',h.context_snapshot->>'taskId')::uuid ELSE NULL END)
     WHERE h.company_id=NEW.company_id AND h.id=NEW.created_by_run_id AND h.agent_id=NEW.created_by_agent_id
       AND i.conversation_agent_id=h.agent_id AND i.conversation_user_id=h.responsible_user_id;
   IF source_run IS NOT NULL THEN
     IF EXISTS(SELECT 1 FROM workflows WHERE company_id=NEW.company_id AND id=NEW.workflow_id
       AND jsonb_array_length(authoring_source_run_ids)>=32 AND NOT authoring_source_run_ids ? source_run::text) THEN
       RAISE EXCEPTION 'Complete workflow source review exceeds its admission bound' USING ERRCODE='23514'; END IF;
     PERFORM set_config('aw.workflow_authoring_source_capture',NEW.workflow_id::text||':'||source_run::text,true);
     UPDATE workflows SET authoring_source_run_ids=authoring_source_run_ids||jsonb_build_array(source_run::text)
       WHERE company_id=NEW.company_id AND id=NEW.workflow_id AND NOT authoring_source_run_ids ? source_run::text;
     PERFORM set_config('aw.workflow_authoring_source_capture','',true);
   END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aaa_capture_workflow_authoring_source BEFORE INSERT ON workflow_revisions
 FOR EACH ROW EXECUTE FUNCTION aw_capture_workflow_authoring_source();
--> statement-breakpoint
CREATE FUNCTION aw_guard_workflow_authoring_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE workflow uuid; ref text;
BEGIN
 IF TG_TABLE_NAME='workflows' THEN
   workflow:=NEW.id;
   IF TG_OP='UPDATE' THEN
     IF NOT NEW.authoring_source_run_ids @> OLD.authoring_source_run_ids THEN
       RAISE EXCEPTION 'Workflow authoring provenance cannot be removed' USING ERRCODE='23514'; END IF;
     IF NEW.authoring_source_run_ids IS DISTINCT FROM OLD.authoring_source_run_ids THEN
       FOR ref IN SELECT jsonb_array_elements_text(NEW.authoring_source_run_ids) EXCEPT SELECT jsonb_array_elements_text(OLD.authoring_source_run_ids) LOOP
         IF current_setting('aw.workflow_authoring_source_capture',true) IS DISTINCT FROM NEW.id::text||':'||ref THEN
           RAISE EXCEPTION 'Workflow source capture requires the Native revision owner' USING ERRCODE='23514'; END IF;
       END LOOP;
     END IF;
   END IF;
   IF aw_workflow_authoring_source_erased(NEW.company_id,workflow,NEW.authoring_source_run_ids) THEN
     NEW.name:='Source-erased workflow'; NEW.description:=NULL; NEW.status:='paused'; NEW.archived_at:=NULL;
     NEW.published_revision_id:=NULL; NEW.draft_revision_id:=NULL;
   END IF;
 ELSIF TG_TABLE_NAME='workflow_revisions' THEN
   IF aw_workflow_authoring_source_erased(NEW.company_id,NEW.workflow_id) THEN
     NEW.graph_json:='{"version":1,"nodes":[],"edges":[],"variables":[],"settings":{}}'::jsonb;
     NEW.input_schema:=NULL; NEW.output_schema:=NULL; NEW.change_summary:=NULL;
     NEW.state:=CASE WHEN NEW.state IN ('published','superseded') THEN 'superseded' ELSE 'discarded' END;
   END IF;
 ELSIF TG_TABLE_NAME='workflow_runs' THEN
   IF aw_workflow_authoring_source_erased(NEW.company_id,NEW.workflow_id) THEN
     NEW.trigger_payload:='{}'::jsonb; NEW.failure_message:=NULL;
     -- Keep the Original cancellation-only reconciler responsible for child,
     -- wait and provider cleanup; erasure cannot claim physical termination.
     IF NEW.status NOT IN ('succeeded','failed','cancelled') THEN NEW.status:='cancelling'; NEW.finished_at:=NULL; END IF;
     NEW.execution_owner_id:=NULL; NEW.lease_expires_at:=NULL;
   END IF;
 ELSIF TG_TABLE_NAME='workflow_step_runs' THEN
   SELECT workflow_id INTO workflow FROM workflow_runs WHERE company_id=NEW.company_id AND id=NEW.workflow_run_id;
   IF workflow IS NOT NULL AND aw_workflow_authoring_source_erased(NEW.company_id,workflow) THEN
     NEW.input_json:=NULL; NEW.output_json:=NULL; NEW.task_result_json:=NULL; NEW.error_message:=NULL;
     IF NEW.status NOT IN ('succeeded','failed','cancelled','skipped','retried') THEN NEW.status:='cancelling'; NEW.finished_at:=NULL; END IF;
   END IF;
 ELSIF TG_TABLE_NAME='workflow_waits' THEN
   SELECT workflow_id INTO workflow FROM workflow_runs WHERE company_id=NEW.company_id AND id=NEW.workflow_run_id;
   IF workflow IS NOT NULL AND aw_workflow_authoring_source_erased(NEW.company_id,workflow) THEN
     IF TG_OP='UPDATE' THEN
       -- Content erasure cannot discard the Original cancellation reconciler's
       -- content-free, exact-wait cleanup marker.
       IF OLD.status IN ('cancelled','timed_out') AND OLD.resolution_json->>'parentCancellation'='true'
         AND OLD.resolution_json->>'errorCode'='workflow_parent_cancelled' THEN
         NEW.status:=OLD.status; NEW.resolution_json:=OLD.resolution_json;
       END IF;
     END IF;
     IF NEW.status IN ('cancelled','timed_out') AND NEW.resolution_json->>'parentCancellation'='true'
       AND NEW.resolution_json->>'errorCode'='workflow_parent_cancelled' THEN
       NEW.resolution_json:='{"parentCancellation":true,"errorCode":"workflow_parent_cancelled"}'::jsonb;
     ELSE NEW.resolution_json:=NULL; END IF;
   END IF;
 ELSIF TG_TABLE_NAME='workflow_run_reviews' THEN
   SELECT workflow_id INTO workflow FROM workflow_runs WHERE company_id=NEW.company_id AND id=NEW.workflow_run_id;
   IF workflow IS NOT NULL AND aw_workflow_authoring_source_erased(NEW.company_id,workflow) THEN
     NEW.corrected_outputs:='{}'::jsonb; NEW.reason:='Source payload erased'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aab_workflow_authoring_source_guard BEFORE INSERT OR UPDATE ON workflows
 FOR EACH ROW EXECUTE FUNCTION aw_guard_workflow_authoring_source();
--> statement-breakpoint
CREATE TRIGGER aab_workflow_authoring_source_guard BEFORE INSERT OR UPDATE ON workflow_revisions
 FOR EACH ROW EXECUTE FUNCTION aw_guard_workflow_authoring_source();
--> statement-breakpoint
CREATE TRIGGER aab_workflow_authoring_source_guard BEFORE INSERT OR UPDATE ON workflow_runs
 FOR EACH ROW EXECUTE FUNCTION aw_guard_workflow_authoring_source();
--> statement-breakpoint
CREATE TRIGGER aab_workflow_authoring_source_guard BEFORE INSERT OR UPDATE ON workflow_step_runs
 FOR EACH ROW EXECUTE FUNCTION aw_guard_workflow_authoring_source();
--> statement-breakpoint
CREATE TRIGGER aab_workflow_authoring_source_guard BEFORE INSERT OR UPDATE ON workflow_waits
 FOR EACH ROW EXECUTE FUNCTION aw_guard_workflow_authoring_source();
--> statement-breakpoint
CREATE TRIGGER aab_workflow_authoring_source_guard BEFORE INSERT OR UPDATE ON workflow_run_reviews
 FOR EACH ROW EXECUTE FUNCTION aw_guard_workflow_authoring_source();
--> statement-breakpoint
-- Preserve the Original immutability guard, adding only the Native erasure
-- exception for the already specified empty, unavailable revision shape.
DO $$ BEGIN
 EXECUTE replace(pg_get_functiondef('aw_guard_workflow_revision_update()'::regprocedure),
   'IF aw_learning_asset_erased(OLD.company_id,''workflow_revision'',OLD.id)',
   'IF (aw_learning_asset_erased(OLD.company_id,''workflow_revision'',OLD.id) OR aw_workflow_authoring_source_erased(OLD.company_id,OLD.workflow_id))');
END $$;
--> statement-breakpoint
-- Original descendant runs/tasks retain this additional copy owner. Bounded
-- recursive source review fails closed rather than inventing a reader grant.
DO $$ BEGIN
 EXECUTE replace(pg_get_functiondef('aw_workflow_memory_erased(uuid,uuid,uuid)'::regprocedure),
   'CREATE OR REPLACE FUNCTION public.aw_workflow_memory_erased(',
   'CREATE OR REPLACE FUNCTION public.aw_workflow_memory_erased_before_authoring(');
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_workflow_memory_erased(company uuid, execution uuid, task uuid)
RETURNS boolean LANGUAGE sql VOLATILE AS $$
 WITH copy_owners AS MATERIALIZED (
   -- Materialize the actual relationship before invoking its source function.
   -- SQL boolean evaluation order cannot supply provenance or prevent recursion.
   SELECT DISTINCT w.workflow_id FROM workflow_runs w WHERE w.company_id=company AND
     (w.execution_agent_run_id=execution OR EXISTS(SELECT 1 FROM workflow_step_runs s WHERE s.company_id=company
       AND s.workflow_run_id=w.id AND s.heartbeat_run_id=execution)
       OR EXISTS(SELECT 1 FROM issues i WHERE i.company_id=company AND i.id=task
         AND i.origin_kind='workflow_task' AND i.origin_run_id=w.id::text))
 )
 SELECT aw_workflow_memory_erased_before_authoring(company,execution,task)
   OR EXISTS(SELECT 1 FROM copy_owners owner WHERE aw_workflow_authoring_source_erased(company,owner.workflow_id))
$$;
--> statement-breakpoint
CREATE FUNCTION aw_erase_workflow_authoring_sources(company uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE target uuid;
BEGIN
 FOR target IN SELECT id FROM workflows WHERE company_id=company AND aw_workflow_authoring_source_erased(company,id) LOOP
   INSERT INTO memory_deletion_markers(company_id,kind,key) VALUES(company,'source','workflow-authoring-source-erasure:v1:'||target::text) ON CONFLICT DO NOTHING;
   UPDATE workflows SET name='Source-erased workflow',description=NULL,status='paused',archived_at=NULL,
     published_revision_id=NULL,draft_revision_id=NULL,updated_at=now() WHERE company_id=company AND id=target;
   UPDATE workflow_revisions SET graph_json='{"version":1,"nodes":[],"edges":[],"variables":[],"settings":{}}'::jsonb,
     input_schema=NULL,output_schema=NULL,change_summary=NULL,
     state=CASE WHEN state IN ('published','superseded') THEN 'superseded' ELSE 'discarded' END WHERE company_id=company AND workflow_id=target;
   UPDATE workflow_runs SET trigger_payload='{}'::jsonb,failure_message=NULL WHERE company_id=company AND workflow_id=target;
   UPDATE workflow_step_runs SET input_json=NULL,output_json=NULL,task_result_json=NULL,error_message=NULL WHERE company_id=company
     AND workflow_run_id IN (SELECT id FROM workflow_runs WHERE company_id=company AND workflow_id=target);
   UPDATE workflow_waits SET resolution_json=CASE WHEN status IN ('cancelled','timed_out')
     AND resolution_json->>'parentCancellation'='true' AND resolution_json->>'errorCode'='workflow_parent_cancelled'
     THEN '{"parentCancellation":true,"errorCode":"workflow_parent_cancelled"}'::jsonb ELSE NULL END
     WHERE company_id=company AND workflow_run_id IN(SELECT id FROM workflow_runs WHERE company_id=company AND workflow_id=target);
   UPDATE workflow_run_reviews SET corrected_outputs='{}'::jsonb,reason='Source payload erased' WHERE company_id=company
     AND workflow_run_id IN(SELECT id FROM workflow_runs WHERE company_id=company AND workflow_id=target);
   UPDATE activity_log SET details='{"payloadDeleted":true}'::jsonb WHERE company_id=company
     AND ((entity_type='workflow' AND entity_id=target::text) OR (entity_type='workflow_run'
       AND entity_id IN(SELECT id::text FROM workflow_runs WHERE company_id=company AND workflow_id=target))
       OR (entity_type='workflow_step_run' AND entity_id IN(SELECT id::text FROM workflow_step_runs WHERE company_id=company
         AND workflow_run_id IN(SELECT id FROM workflow_runs WHERE company_id=company AND workflow_id=target)))
       OR (entity_type='workflow_wait' AND entity_id IN(SELECT id::text FROM workflow_waits WHERE company_id=company
         AND workflow_run_id IN(SELECT id FROM workflow_runs WHERE company_id=company AND workflow_id=target))));
 END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION aw_guard_workflow_authoring_activity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid;
BEGIN
 IF NEW.entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
   IF NEW.entity_type='workflow' THEN target:=NEW.entity_id::uuid;
   ELSIF NEW.entity_type='workflow_run' THEN SELECT workflow_id INTO target FROM workflow_runs WHERE company_id=NEW.company_id AND id=NEW.entity_id::uuid;
   ELSIF NEW.entity_type='workflow_step_run' THEN SELECT r.workflow_id INTO target FROM workflow_step_runs s JOIN workflow_runs r ON r.company_id=s.company_id AND r.id=s.workflow_run_id WHERE s.company_id=NEW.company_id AND s.id=NEW.entity_id::uuid;
   ELSIF NEW.entity_type='workflow_wait' THEN SELECT r.workflow_id INTO target FROM workflow_waits w JOIN workflow_runs r ON r.company_id=w.company_id AND r.id=w.workflow_run_id WHERE w.company_id=NEW.company_id AND w.id=NEW.entity_id::uuid;
   END IF;
 END IF;
 IF target IS NOT NULL AND aw_workflow_authoring_source_erased(NEW.company_id,target) THEN NEW.details:='{"payloadDeleted":true}'::jsonb; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_workflow_authoring_activity_guard BEFORE INSERT OR UPDATE ON activity_log
 FOR EACH ROW EXECUTE FUNCTION aw_guard_workflow_authoring_activity();
--> statement-breakpoint
CREATE FUNCTION aw_workflow_authoring_delete_marker() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid;
BEGIN
 IF EXISTS(SELECT 1 FROM companies WHERE id=OLD.company_id) THEN
   IF TG_TABLE_NAME='workflows' THEN
     IF jsonb_array_length(OLD.authoring_source_run_ids)>0 THEN
       INSERT INTO memory_deletion_markers(company_id,kind,key) VALUES(OLD.company_id,'source','workflow-authoring-source-erasure:v1:'||OLD.id::text) ON CONFLICT DO NOTHING;
     END IF;
   ELSIF TG_TABLE_NAME='heartbeat_runs' THEN
     FOR target IN SELECT id FROM workflows WHERE company_id=OLD.company_id AND authoring_source_run_ids ? OLD.id::text LOOP
       INSERT INTO memory_deletion_markers(company_id,kind,key) VALUES(OLD.company_id,'source','workflow-authoring-source-erasure:v1:'||target::text) ON CONFLICT DO NOTHING;
     END LOOP;
   END IF;
 END IF;
 RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_workflow_authoring_delete_marker BEFORE DELETE ON workflows
 FOR EACH ROW EXECUTE FUNCTION aw_workflow_authoring_delete_marker();
--> statement-breakpoint
CREATE TRIGGER aw_workflow_authoring_delete_marker BEFORE DELETE ON heartbeat_runs
 FOR EACH ROW EXECUTE FUNCTION aw_workflow_authoring_delete_marker();
