ALTER TABLE "project_roadmap_proposals" ADD COLUMN "planning_context_json" jsonb;--> statement-breakpoint
ALTER TABLE "project_roadmap_proposals" ADD COLUMN "planning_context_hash" text;--> statement-breakpoint
ALTER TABLE "project_roadmap_proposals" ADD COLUMN "planning_manifest_id" uuid;--> statement-breakpoint
ALTER TABLE "project_roadmap_proposals" ADD CONSTRAINT "project_roadmap_planning_manifest_fk" FOREIGN KEY ("company_id","planning_manifest_id") REFERENCES "public"."analytical_lineage_manifests"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_roadmap_proposals" ADD CONSTRAINT "project_roadmap_planning_material_check" CHECK (("project_roadmap_proposals"."planning_context_json" is null and "project_roadmap_proposals"."planning_context_hash" is null and "project_roadmap_proposals"."planning_manifest_id" is null) or ("project_roadmap_proposals"."planning_context_json" is not null and "project_roadmap_proposals"."planning_context_hash" is not null and "project_roadmap_proposals"."planning_context_hash" ~ '^[0-9a-f]{64}$' and "project_roadmap_proposals"."planning_manifest_id" is not null));
--> statement-breakpoint
CREATE FUNCTION aw_project_planning_material_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m analytical_lineage_manifests%ROWTYPE; item jsonb; planned jsonb; source jsonb; start_at timestamptz;
BEGIN
 IF TG_OP='UPDATE' AND OLD.planning_context_json IS NOT NULL THEN
  IF ROW(NEW.company_id,NEW.project_id,NEW.patch_json,NEW.reason,NEW.risk,NEW.created_by_agent_id,NEW.created_by_user_id,NEW.created_at,NEW.planning_context_json,NEW.planning_context_hash,NEW.planning_manifest_id)
   IS DISTINCT FROM ROW(OLD.company_id,OLD.project_id,OLD.patch_json,OLD.reason,OLD.risk,OLD.created_by_agent_id,OLD.created_by_user_id,OLD.created_at,OLD.planning_context_json,OLD.planning_context_hash,OLD.planning_manifest_id) THEN
   RAISE EXCEPTION 'project_planning_material_immutable' USING ERRCODE='23514'; END IF;
  IF NEW.status='accepted' AND OLD.status<>'accepted' THEN
   SELECT * INTO m FROM analytical_lineage_manifests WHERE company_id=NEW.company_id AND id=NEW.planning_manifest_id;
   IF m.id IS NULL OR m.expires_at<=statement_timestamp() OR NEW.reviewed_by_user_id IS NULL OR length(trim(NEW.review_rationale))<10
    OR NOT EXISTS(SELECT 1 FROM instance_settings WHERE singleton_key='default' AND experimental->>'planning_optimizer_v8'='true' AND experimental->>'adaptive_planning_v8'='true')
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.patch_json->'changes') c WHERE NOT EXISTS(SELECT 1 FROM issues i
      WHERE i.company_id=NEW.company_id AND i.project_id=NEW.project_id AND i.id::text=c->>'issueId'
      AND i.hidden_at IS NULL AND i.planned_start_at=(c->'patch'->>'plannedStartAt')::timestamptz AND i.planned_end_at=(c->'patch'->>'plannedEndAt')::timestamptz)) THEN
    RAISE EXCEPTION 'project_planning_canonical_review_and_applied_plan_required' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
 END IF;
 IF NEW.planning_context_json IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO m FROM analytical_lineage_manifests WHERE company_id=NEW.company_id AND id=NEW.planning_manifest_id;
 IF m.id IS NULL OR m.expires_at<=statement_timestamp() OR m.analysis_type<>'project_planning_proposal' OR m.analysis_ref<>NEW.id
  OR m.definition_hash IS DISTINCT FROM NEW.planning_context_hash OR m.input_hash IS DISTINCT FROM NEW.planning_context_json->>'snapshotHash'
  OR m.created_at<>NEW.created_at OR m.requested_by IS DISTINCT FROM NEW.created_by_user_id OR m.parameters_json->>'signature' IS NULL
  OR NEW.status<>'pending' OR NEW.created_by_agent_id IS NOT NULL
  OR NEW.planning_context_json->>'authority' IS DISTINCT FROM 'human_roadmap_review_required'
  OR NEW.planning_context_json->'result'->>'status' IS DISTINCT FROM 'feasible_best_known'
  OR NEW.planning_context_json->'result'->>'optimality' IS DISTINCT FROM 'not_proven'
  OR NEW.planning_context_json->'sourceSnapshot'->>'projectId' IS DISTINCT FROM NEW.project_id::text
  OR NEW.patch_json->>'expectedProjectUpdatedAt' IS DISTINCT FROM NEW.planning_context_json->'sourceSnapshot'->>'projectUpdatedAt'
  OR (NEW.planning_context_json->>'expiresAt')::timestamptz<>m.expires_at
  OR jsonb_array_length(NEW.patch_json->'changes')<>jsonb_array_length(NEW.planning_context_json->'result'->'schedule')
  OR jsonb_array_length(NEW.patch_json->'changes')<>jsonb_array_length(NEW.planning_context_json->'sourceSnapshot'->'tasks') THEN
  RAISE EXCEPTION 'project_planning_exact_native_material_required' USING ERRCODE='23514'; END IF;
 start_at:=((NEW.planning_context_json->'profile'->'horizon'->>'start') || 'T00:00:00Z')::timestamptz;
 FOR item IN SELECT value FROM jsonb_array_elements(NEW.patch_json->'changes') LOOP
  SELECT value INTO planned FROM jsonb_array_elements(NEW.planning_context_json->'result'->'schedule') WHERE value->>'taskKey'=item->>'issueId';
  SELECT value INTO source FROM jsonb_array_elements(NEW.planning_context_json->'sourceSnapshot'->'tasks') WHERE value->>'id'=item->>'issueId';
  IF planned IS NULL OR source IS NULL OR item->>'expectedUpdatedAt' IS DISTINCT FROM source->>'updatedAt'
   OR (item->'patch'->>'plannedStartAt')::timestamptz<>start_at+(planned->>'startDay')::integer*interval '1 day'
   OR (item->'patch'->>'plannedEndAt')::timestamptz<>start_at+(planned->>'endDay')::integer*interval '1 day'
   OR NOT EXISTS(SELECT 1 FROM analytical_lineage_edges WHERE company_id=NEW.company_id AND manifest_id=m.id AND input_type='issue' AND input_ref::text=item->>'issueId') THEN
   RAISE EXCEPTION 'project_planning_exact_native_schedule_required' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_project_planning_material_guard BEFORE INSERT OR UPDATE ON project_roadmap_proposals FOR EACH ROW EXECUTE FUNCTION aw_project_planning_material_guard();
--> statement-breakpoint
CREATE FUNCTION aw_project_planning_lineage_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p project_roadmap_proposals%ROWTYPE; m analytical_lineage_manifests%ROWTYPE;
BEGIN
 SELECT * INTO p FROM project_roadmap_proposals WHERE company_id=NEW.company_id AND id=NEW.id;
 IF p.id IS NULL OR p.planning_manifest_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO m FROM analytical_lineage_manifests WHERE company_id=p.company_id AND id=p.planning_manifest_id;
 IF m.id IS NULL OR m.source_count<>(SELECT count(*) FROM analytical_lineage_edges WHERE company_id=p.company_id AND manifest_id=m.id)
  OR NOT EXISTS(SELECT 1 FROM analytical_lineage_edges WHERE company_id=p.company_id AND manifest_id=m.id AND input_type='project' AND input_ref=p.project_id) THEN
  RAISE EXCEPTION 'project_planning_lineage_incomplete' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER aw_project_planning_lineage_complete AFTER INSERT OR UPDATE ON project_roadmap_proposals DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION aw_project_planning_lineage_complete();
