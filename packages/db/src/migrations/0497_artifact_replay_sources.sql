ALTER TABLE "automation_artifacts" ADD COLUMN "authoring_source_workflow_ids" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
-- Only actual Native run rows supply copied Workflow owners. Missing legacy
-- rows produce unavailable provenance, never an invented empty source list.
CREATE FUNCTION aw_optimizer_artifact_workflow_sources(company uuid, runs jsonb, origin uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
DECLARE ref text; parent uuid; copied jsonb; result jsonb:='[]'::jsonb;
BEGIN
 IF runs IS NULL OR jsonb_typeof(runs)<>'array' OR jsonb_array_length(runs)>100 THEN RETURN NULL; END IF;
 FOR ref IN SELECT DISTINCT value FROM jsonb_array_elements_text(runs) LOOP
   IF ref !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN NULL; END IF;
   SELECT workflow_id,authoring_source_workflow_ids INTO parent,copied FROM workflow_runs WHERE company_id=company AND id=ref::uuid FOR KEY SHARE;
   IF parent IS NULL OR copied IS NULL OR jsonb_typeof(copied)<>'array' THEN RETURN NULL; END IF;
   result:=result||copied||jsonb_build_array(parent::text);
 END LOOP;
 SELECT coalesce(jsonb_agg(value ORDER BY value),'[]'::jsonb) INTO result FROM
   (SELECT DISTINCT value FROM jsonb_array_elements_text(result) WHERE origin IS NULL OR value<>origin::text) refs;
 IF jsonb_array_length(result)>32 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(result) r(value)
   WHERE value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN RETURN NULL; END IF;
 RETURN result;
END $$;
--> statement-breakpoint
-- Backfill actual observation/replay relationships; retain unresolvable legacy
-- bodies behind an unavailable Source boundary rather than claiming erasure.
UPDATE automation_artifacts a SET authoring_source_workflow_ids=CASE
 WHEN a.created_by_optimizer_suggestion_id IS NULL AND NOT EXISTS(SELECT 1 FROM workflow_optimizer_evaluations e WHERE e.company_id=a.company_id AND e.artifact_id=a.id) THEN '[]'::jsonb
 WHEN a.created_by_optimizer_suggestion_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM workflow_optimizer_suggestions s WHERE s.company_id=a.company_id AND s.id=a.created_by_optimizer_suggestion_id AND jsonb_typeof(s.observed_run_ids)='array' AND jsonb_array_length(s.observed_run_ids)>0) THEN NULL
 ELSE aw_optimizer_artifact_workflow_sources(a.company_id,
   coalesce((SELECT s.observed_run_ids FROM workflow_optimizer_suggestions s WHERE s.company_id=a.company_id AND s.id=a.created_by_optimizer_suggestion_id),'[]'::jsonb)||
   coalesce((SELECT jsonb_agg(r.value) FROM workflow_optimizer_evaluations e CROSS JOIN LATERAL jsonb_array_elements(e.source_run_ids) r(value) WHERE e.company_id=a.company_id AND e.artifact_id=a.id),'[]'::jsonb),a.origin_workflow_id) END;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_artifact_workflow_source_erased(company uuid, artifact uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE AS $$
DECLARE root uuid; refs jsonb; ref text;
BEGIN
 IF EXISTS(SELECT 1 FROM memory_deletion_markers m WHERE m.company_id=company AND m.kind='source' AND m.key='artifact-workflow-source-erasure:v1:'||artifact::text) THEN RETURN true; END IF;
 SELECT origin_workflow_id,authoring_source_workflow_ids INTO root,refs FROM automation_artifacts WHERE company_id=company AND id=artifact;
 IF root IS NOT NULL AND aw_workflow_authoring_source_erased(company,root) THEN RETURN true; END IF;
 IF refs IS NULL THEN RETURN false; END IF;
 IF jsonb_typeof(refs)<>'array' THEN RETURN true; END IF;
 FOR ref IN SELECT jsonb_array_elements_text(refs) LOOP
   IF ref !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR aw_workflow_authoring_source_erased(company,ref::uuid) THEN RETURN true; END IF;
 END LOOP;
 RETURN false;
END $$;
--> statement-breakpoint
DO $$ DECLARE definition text; needle text:='aw_artifact_workflow_source_erased(p_company, v.artifact_id)'; BEGIN
 definition:=pg_get_functiondef('aw_learning_asset_current(uuid,text,uuid)'::regprocedure);
 IF strpos(definition,needle)=0 THEN needle:='aw_artifact_workflow_source_erased(p_company,v.artifact_id)'; END IF;
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Native current Artifact Source owner changed'; END IF;
 EXECUTE replace(definition,needle,'('||needle||' OR EXISTS(SELECT 1 FROM automation_artifacts a WHERE a.company_id=p_company AND a.id=v.artifact_id AND a.authoring_source_workflow_ids IS NULL))');
END $$;
--> statement-breakpoint
-- Compose exact Source capture into the existing Artifact metadata owner.
CREATE OR REPLACE FUNCTION aw_guard_artifact_workflow_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE origin uuid; runs jsonb; refs jsonb; captured boolean:=false; ref text;
BEGIN
 IF TG_OP='UPDATE' AND OLD.origin_workflow_id IS NOT NULL AND NEW.origin_workflow_id IS DISTINCT FROM OLD.origin_workflow_id THEN
   RAISE EXCEPTION 'Artifact workflow Source provenance cannot be removed or retargeted' USING ERRCODE='23514'; END IF;
 IF NEW.created_by_optimizer_suggestion_id IS NOT NULL THEN
   SELECT workflow_id,observed_run_ids INTO origin,runs FROM workflow_optimizer_suggestions WHERE company_id=NEW.company_id AND id=NEW.created_by_optimizer_suggestion_id;
   IF origin IS NOT NULL THEN
     IF NEW.origin_workflow_id IS NOT NULL AND NEW.origin_workflow_id<>origin THEN RAISE EXCEPTION 'Artifact optimizer Source changed' USING ERRCODE='23514'; END IF;
     NEW.origin_workflow_id:=origin;
   END IF;
   IF TG_OP='INSERT' OR NEW.created_by_optimizer_suggestion_id IS DISTINCT FROM OLD.created_by_optimizer_suggestion_id THEN
     IF runs IS NULL OR jsonb_typeof(runs)<>'array' OR jsonb_array_length(runs)=0 THEN
       RAISE EXCEPTION 'Native optimizer observation Sources are unavailable' USING ERRCODE='23514'; END IF;
     refs:=aw_optimizer_artifact_workflow_sources(NEW.company_id,runs,NEW.origin_workflow_id);
     IF refs IS NULL THEN RAISE EXCEPTION 'Complete Native optimizer Artifact Sources are unavailable' USING ERRCODE='23514'; END IF;
     IF NEW.authoring_source_workflow_ids IS NOT NULL THEN
       SELECT coalesce(jsonb_agg(value ORDER BY value),'[]'::jsonb) INTO NEW.authoring_source_workflow_ids FROM
         (SELECT DISTINCT value FROM jsonb_array_elements_text(NEW.authoring_source_workflow_ids||refs)) ids;
     END IF;
     captured:=true;
   END IF;
 END IF;
 IF TG_OP='UPDATE' AND NEW.authoring_source_workflow_ids IS DISTINCT FROM OLD.authoring_source_workflow_ids THEN
   IF OLD.authoring_source_workflow_ids IS NULL OR NEW.authoring_source_workflow_ids IS NULL OR NOT NEW.authoring_source_workflow_ids @> OLD.authoring_source_workflow_ids
     OR (NOT captured AND current_setting('aw.artifact_workflow_source_capture',true) IS DISTINCT FROM NEW.company_id::text||':'||NEW.id::text) THEN
     RAISE EXCEPTION 'Native Artifact copy Sources cannot be removed or replaced' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.authoring_source_workflow_ids IS NOT NULL AND (jsonb_typeof(NEW.authoring_source_workflow_ids)<>'array' OR jsonb_array_length(NEW.authoring_source_workflow_ids)>32
   OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW.authoring_source_workflow_ids) r(value) WHERE value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')) THEN
   RAISE EXCEPTION 'Complete Native Artifact copy Sources are invalid' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM memory_deletion_markers m WHERE m.company_id=NEW.company_id AND m.kind='source' AND m.key='artifact-workflow-source-erasure:v1:'||NEW.id::text)
   OR (NEW.origin_workflow_id IS NOT NULL AND aw_workflow_authoring_source_erased(NEW.company_id,NEW.origin_workflow_id))
   OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(NEW.authoring_source_workflow_ids,'[]'::jsonb)) r(value) WHERE aw_workflow_authoring_source_erased(NEW.company_id,value::uuid)) THEN
   INSERT INTO memory_deletion_markers(company_id,kind,key) VALUES(NEW.company_id,'source','artifact-workflow-source-erasure:v1:'||NEW.id::text) ON CONFLICT DO NOTHING;
   NEW.name:='Source-erased artifact'; NEW.description:=NULL; NEW.input_schema:='{}'::jsonb; NEW.output_schema:='{}'::jsonb;
   NEW.status:='deprecated'; NEW.archived_at:=coalesce(NEW.archived_at,now());
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
-- Replay inputs can include later actual runs beyond the detector's window.
CREATE FUNCTION aw_capture_optimizer_artifact_copy_sources() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_refs jsonb; origin uuid; runs jsonb; refs jsonb; combined jsonb; prior text;
BEGIN
 IF TG_OP='UPDATE' THEN
   IF (NEW.id,NEW.company_id,NEW.workflow_id,NEW.workflow_revision_id,NEW.suggestion_id,NEW.artifact_id,NEW.artifact_version_id)
     IS DISTINCT FROM (OLD.id,OLD.company_id,OLD.workflow_id,OLD.workflow_revision_id,OLD.suggestion_id,OLD.artifact_id,OLD.artifact_version_id) THEN
     RAISE EXCEPTION 'Native Optimizer copy owner cannot be retargeted' USING ERRCODE='23514'; END IF;
   IF NEW.source_run_ids IS NOT DISTINCT FROM OLD.source_run_ids THEN RETURN NEW; END IF;
 END IF;
 SELECT authoring_source_workflow_ids,origin_workflow_id INTO current_refs,origin FROM automation_artifacts WHERE company_id=NEW.company_id AND id=NEW.artifact_id FOR UPDATE;
 IF current_refs IS NULL THEN RAISE EXCEPTION 'Complete Native Artifact Source owner is unavailable' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND aw_artifact_workflow_source_erased(NEW.company_id,NEW.artifact_id) THEN RETURN NEW; END IF;
 SELECT observed_run_ids INTO runs FROM workflow_optimizer_suggestions WHERE company_id=NEW.company_id AND id=NEW.suggestion_id;
 refs:=aw_optimizer_artifact_workflow_sources(NEW.company_id,coalesce(runs,'[]'::jsonb)||NEW.source_run_ids,origin);
 IF refs IS NULL THEN RAISE EXCEPTION 'Complete Native Optimizer replay Sources are unavailable' USING ERRCODE='23514'; END IF;
 SELECT coalesce(jsonb_agg(value ORDER BY value),'[]'::jsonb) INTO combined FROM (SELECT DISTINCT value FROM jsonb_array_elements_text(current_refs||refs)) ids;
 IF jsonb_array_length(combined)>32 THEN RAISE EXCEPTION 'Complete Native Artifact Sources exceed the bounded owner' USING ERRCODE='23514'; END IF;
 prior:=current_setting('aw.artifact_workflow_source_capture',true);
 PERFORM set_config('aw.artifact_workflow_source_capture',NEW.company_id::text||':'||NEW.artifact_id::text,true);
 UPDATE automation_artifacts SET authoring_source_workflow_ids=combined WHERE company_id=NEW.company_id AND id=NEW.artifact_id;
 PERFORM set_config('aw.artifact_workflow_source_capture',coalesce(prior,''),true);
 IF aw_artifact_workflow_source_erased(NEW.company_id,NEW.artifact_id) THEN RAISE EXCEPTION 'Native replay Sources were erased or withdrawn' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aaa_optimizer_artifact_copy_sources BEFORE INSERT OR UPDATE ON workflow_optimizer_evaluations
 FOR EACH ROW EXECUTE FUNCTION aw_capture_optimizer_artifact_copy_sources();
--> statement-breakpoint
CREATE FUNCTION aw_erase_changed_artifact_copy_sources() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.authoring_source_workflow_ids IS DISTINCT FROM OLD.authoring_source_workflow_ids THEN PERFORM aw_erase_artifact_workflow_sources(NEW.company_id); END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aaz_artifact_copy_source_erasure AFTER UPDATE ON automation_artifacts
 FOR EACH ROW EXECUTE FUNCTION aw_erase_changed_artifact_copy_sources();
--> statement-breakpoint
-- An unresolved legacy parent cannot admit a new version/copy.
CREATE FUNCTION aw_guard_artifact_copy_source_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM automation_artifacts a WHERE a.company_id=NEW.company_id AND a.id=NEW.artifact_id AND a.authoring_source_workflow_ids IS NOT NULL) THEN
   RAISE EXCEPTION 'Complete Native Artifact Sources are unavailable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aaa_artifact_copy_source_version BEFORE INSERT ON automation_artifact_versions
 FOR EACH ROW EXECUTE FUNCTION aw_guard_artifact_copy_source_version();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_artifact_workflow_delete_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM automation_artifacts a WHERE a.company_id=OLD.company_id AND (a.origin_workflow_id=OLD.id OR a.authoring_source_workflow_ids @> jsonb_build_array(OLD.id::text))) THEN
   INSERT INTO memory_deletion_markers(company_id,kind,key) SELECT OLD.company_id,'source','artifact-workflow-source-erasure:v1:'||a.id::text
     FROM automation_artifacts a WHERE a.company_id=OLD.company_id AND (a.origin_workflow_id=OLD.id OR a.authoring_source_workflow_ids @> jsonb_build_array(OLD.id::text)) ON CONFLICT DO NOTHING;
   PERFORM aw_erase_artifact_workflow_sources(OLD.company_id);
 END IF;
 RETURN OLD;
END $$;
--> statement-breakpoint
DO $$ DECLARE company uuid; BEGIN
 FOR company IN SELECT DISTINCT company_id FROM automation_artifacts LOOP PERFORM aw_erase_artifact_workflow_sources(company); END LOOP;
END $$;
