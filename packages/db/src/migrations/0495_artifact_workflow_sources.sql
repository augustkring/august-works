-- The existing immutable origin workflow FK is the copy owner. No parallel
-- provenance ledger: keep that relationship through all Artifact versions.
CREATE FUNCTION aw_artifact_workflow_source_erased(company uuid, artifact uuid)
RETURNS boolean LANGUAGE sql VOLATILE AS $$
 SELECT EXISTS(SELECT 1 FROM memory_deletion_markers m WHERE m.company_id=company AND m.kind='source'
   AND m.key='artifact-workflow-source-erasure:v1:'||artifact::text)
 OR EXISTS(SELECT 1 FROM automation_artifacts a WHERE a.company_id=company AND a.id=artifact
   AND a.origin_workflow_id IS NOT NULL AND aw_workflow_authoring_source_erased(company,a.origin_workflow_id))
$$;
--> statement-breakpoint
-- Extend the Original canonical asset predicates, preserving their function
-- identity and all existing Learning behavior for other asset kinds.
DO $$ DECLARE definition text; needle text;
BEGIN
 definition:=pg_get_functiondef('aw_learning_asset_erased(uuid,text,uuid)'::regprocedure);
 needle:='SELECT EXISTS (SELECT 1 FROM learning_retained_assets';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Native erased-asset owner changed'; END IF;
 EXECUTE replace(definition,needle,
   'SELECT (p_type=''automation_artifact_version'' AND EXISTS(SELECT 1 FROM automation_artifact_versions v WHERE v.company_id=p_company AND v.id=p_id AND aw_artifact_workflow_source_erased(p_company,v.artifact_id))) OR EXISTS (SELECT 1 FROM learning_retained_assets');
 definition:=pg_get_functiondef('aw_learning_asset_current(uuid,text,uuid)'::regprocedure);
 needle:='SELECT NOT EXISTS (SELECT 1 FROM learning_retained_assets';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Native current-asset owner changed'; END IF;
 EXECUTE replace(definition,needle,
   'SELECT NOT (p_type=''automation_artifact_version'' AND EXISTS(SELECT 1 FROM automation_artifact_versions v WHERE v.company_id=p_company AND v.id=p_id AND aw_artifact_workflow_source_erased(p_company,v.artifact_id))) AND NOT EXISTS (SELECT 1 FROM learning_retained_assets');
END $$;
--> statement-breakpoint
ALTER FUNCTION aw_learning_asset_erased(uuid,text,uuid) VOLATILE;
--> statement-breakpoint
ALTER FUNCTION aw_learning_asset_current(uuid,text,uuid) VOLATILE;
--> statement-breakpoint
-- A BEFORE INSERT version is not visible in its own table yet. The Original
-- content guard must also consult its actual parent Artifact copy owner.
DO $$ DECLARE definition text; needle text;
BEGIN
 definition:=pg_get_functiondef('aw_learning_artifact_payload_guard()'::regprocedure);
 needle:='IF aw_optimizer_artifact_erased(NEW.company_id,NEW.artifact_id) OR';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Native Artifact content owner changed'; END IF;
 EXECUTE replace(definition,needle,'IF aw_artifact_workflow_source_erased(NEW.company_id,NEW.artifact_id) OR aw_optimizer_artifact_erased(NEW.company_id,NEW.artifact_id) OR');
END $$;
--> statement-breakpoint
CREATE FUNCTION aw_guard_artifact_workflow_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE origin uuid;
BEGIN
 IF TG_OP='UPDATE' AND OLD.origin_workflow_id IS NOT NULL AND NEW.origin_workflow_id IS DISTINCT FROM OLD.origin_workflow_id THEN
   RAISE EXCEPTION 'Artifact workflow Source provenance cannot be removed or retargeted' USING ERRCODE='23514'; END IF;
 IF NEW.created_by_optimizer_suggestion_id IS NOT NULL THEN
   SELECT workflow_id INTO origin FROM workflow_optimizer_suggestions
     WHERE company_id=NEW.company_id AND id=NEW.created_by_optimizer_suggestion_id;
   IF origin IS NOT NULL THEN
     IF NEW.origin_workflow_id IS NOT NULL AND NEW.origin_workflow_id<>origin THEN
       RAISE EXCEPTION 'Artifact optimizer Source changed' USING ERRCODE='23514'; END IF;
     NEW.origin_workflow_id:=origin;
   END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM memory_deletion_markers m WHERE m.company_id=NEW.company_id AND m.kind='source'
     AND m.key='artifact-workflow-source-erasure:v1:'||NEW.id::text)
   OR (NEW.origin_workflow_id IS NOT NULL AND aw_workflow_authoring_source_erased(NEW.company_id,NEW.origin_workflow_id)) THEN
   INSERT INTO memory_deletion_markers(company_id,kind,key) VALUES(NEW.company_id,'source',
     'artifact-workflow-source-erasure:v1:'||NEW.id::text) ON CONFLICT DO NOTHING;
   NEW.name:='Source-erased artifact'; NEW.description:=NULL; NEW.input_schema:='{}'::jsonb; NEW.output_schema:='{}'::jsonb;
   NEW.status:='deprecated'; NEW.archived_at:=coalesce(NEW.archived_at,now());
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aaa_artifact_workflow_source BEFORE INSERT OR UPDATE ON automation_artifacts
 FOR EACH ROW EXECUTE FUNCTION aw_guard_artifact_workflow_source();
--> statement-breakpoint
-- Field-name inventories are copied input material too. Retain the Original
-- optimizer guard's complete erasure branch on later restore/update attempts.
DO $$ DECLARE definition text; needle text;
BEGIN
 definition:=pg_get_functiondef('aw_learning_optimizer_lineage_guard()'::regprocedure);
 needle:='NEW.invariants:=''[]''::jsonb;';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Native optimizer erasure owner changed'; END IF;
 EXECUTE replace(definition,needle,needle||' NEW.known_input_shapes:=''[]''::jsonb;');
END $$;
--> statement-breakpoint
-- Capture actual historical optimizer references, never an inferred workflow.
UPDATE automation_artifacts a SET origin_workflow_id=s.workflow_id
 FROM workflow_optimizer_suggestions s WHERE a.company_id=s.company_id AND a.created_by_optimizer_suggestion_id=s.id
 AND a.origin_workflow_id IS NULL;
--> statement-breakpoint
CREATE FUNCTION aw_erase_artifact_workflow_sources(company uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE target uuid;
BEGIN
 FOR target IN SELECT id FROM automation_artifacts WHERE company_id=company AND aw_artifact_workflow_source_erased(company,id) LOOP
   INSERT INTO memory_deletion_markers(company_id,kind,key) VALUES(company,'source',
     'artifact-workflow-source-erasure:v1:'||target::text) ON CONFLICT DO NOTHING;
   UPDATE automation_artifacts SET name='Source-erased artifact',description=NULL,input_schema='{}'::jsonb,output_schema='{}'::jsonb,
     status='deprecated',archived_at=coalesce(archived_at,now()),updated_at=now() WHERE company_id=company AND id=target;
   -- Existing content/immutability guards admit only their Native empty erasure
   -- shape. Existing workspace/copy outboxes retain downstream cleanup ownership.
   UPDATE automation_artifact_versions SET source_code='',input_schema='{}'::jsonb,output_schema='{}'::jsonb,
     dependency_manifest='{}'::jsonb,test_spec='{}'::jsonb,validation_report=NULL,security_report=NULL
     WHERE company_id=company AND artifact_id=target;
   UPDATE workflow_optimizer_evaluations SET status='retired',compiler_result=NULL,replay_evaluation=NULL,shadow_evaluation=NULL,
     invariants='[]'::jsonb,known_input_shapes='[]'::jsonb,updated_at=now() WHERE company_id=company AND artifact_id=target;
   UPDATE workflow_optimizer_observations SET shadow_result=NULL WHERE company_id=company
     AND evaluation_id IN(SELECT id FROM workflow_optimizer_evaluations WHERE company_id=company AND artifact_id=target);
   UPDATE activity_log SET details='{"payloadDeleted":true}'::jsonb WHERE company_id=company
     AND ((entity_type='automation_artifact' AND entity_id=target::text) OR
       (entity_type='automation_artifact_version' AND entity_id IN(SELECT id::text FROM automation_artifact_versions WHERE company_id=company AND artifact_id=target)));
 END LOOP;
END $$;
--> statement-breakpoint
-- Compose cleanup into the Original workflow Source erasure operation.
ALTER FUNCTION aw_erase_workflow_authoring_sources(uuid) RENAME TO aw_erase_workflow_authoring_sources_before_artifacts;
--> statement-breakpoint
CREATE FUNCTION aw_erase_workflow_authoring_sources(company uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM aw_erase_workflow_authoring_sources_before_artifacts(company);
 PERFORM aw_erase_artifact_workflow_sources(company);
END $$;
--> statement-breakpoint
CREATE FUNCTION aw_guard_artifact_workflow_activity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE artifact uuid;
BEGIN
 IF NEW.entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
   IF NEW.entity_type='automation_artifact' THEN artifact:=NEW.entity_id::uuid;
   ELSIF NEW.entity_type='automation_artifact_version' THEN
     SELECT artifact_id INTO artifact FROM automation_artifact_versions WHERE company_id=NEW.company_id AND id=NEW.entity_id::uuid;
   END IF;
 END IF;
 IF artifact IS NOT NULL AND aw_artifact_workflow_source_erased(NEW.company_id,artifact) THEN NEW.details:='{"payloadDeleted":true}'::jsonb; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_artifact_workflow_activity BEFORE INSERT OR UPDATE ON activity_log
 FOR EACH ROW EXECUTE FUNCTION aw_guard_artifact_workflow_activity();
--> statement-breakpoint
CREATE FUNCTION aw_artifact_workflow_delete_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM companies WHERE id=OLD.company_id) AND OLD.origin_workflow_id IS NOT NULL AND EXISTS(
   SELECT 1 FROM workflows w WHERE w.company_id=OLD.company_id AND w.id=OLD.origin_workflow_id
     AND jsonb_array_length(w.authoring_source_run_ids)>0) THEN
   INSERT INTO memory_deletion_markers(company_id,kind,key) VALUES(OLD.company_id,'source',
     'artifact-workflow-source-erasure:v1:'||OLD.id::text) ON CONFLICT DO NOTHING;
 END IF;
 RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_artifact_workflow_deleted BEFORE DELETE ON automation_artifacts
 FOR EACH ROW EXECUTE FUNCTION aw_artifact_workflow_delete_source();
--> statement-breakpoint
-- Reconcile every actual persisted relationship before a reader/worker starts.
DO $$ DECLARE company uuid; BEGIN
 FOR company IN SELECT DISTINCT company_id FROM automation_artifacts WHERE origin_workflow_id IS NOT NULL LOOP
   PERFORM aw_erase_artifact_workflow_sources(company);
 END LOOP;
END $$;
