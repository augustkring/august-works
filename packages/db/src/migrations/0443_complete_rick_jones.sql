ALTER TABLE "adaptive_planning_proposals" DROP CONSTRAINT "adaptive_planning_proposals_state_check";--> statement-breakpoint
ALTER TABLE "analytical_lineage_edges" DROP CONSTRAINT "analytical_lineage_edges_type_check";--> statement-breakpoint
ALTER TABLE "adaptive_planning_proposals" ADD COLUMN "initiative_context_json" jsonb;--> statement-breakpoint
ALTER TABLE "adaptive_planning_proposals" ADD COLUMN "applied_project_refs_json" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "adaptive_planning_proposals" ADD CONSTRAINT "adaptive_planning_proposals_state_check" CHECK ("adaptive_planning_proposals"."proposal_type" in ('change_schedule','prioritize_initiatives') and "adaptive_planning_proposals"."status" in ('proposed','under_review','accepted','rejected','cancelled') and "adaptive_planning_proposals"."revision">0 and ("adaptive_planning_proposals"."proposal_type"='prioritize_initiatives')=("adaptive_planning_proposals"."initiative_context_json" is not null));--> statement-breakpoint
ALTER TABLE "analytical_lineage_edges" ADD CONSTRAINT "analytical_lineage_edges_type_check" CHECK ("analytical_lineage_edges"."input_type" in ('issue','project','goal','metric_version','governance_obligation','business_event_source') and "analytical_lineage_edges"."relationship" in ('source','definition','policy'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_cross_project_planning_material_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m analytical_lineage_manifests%ROWTYPE; ref jsonb; item jsonb; scheduled jsonb; child project_roadmap_proposals%ROWTYPE; start_at timestamptz; native_project projects%ROWTYPE; candidate jsonb;
BEGIN

 IF NEW.proposal_type='prioritize_initiatives' THEN
  IF TG_OP='UPDATE' THEN
   IF ROW(NEW.id,NEW.company_id,NEW.proposal_type,NEW.context_json,NEW.initiative_context_json,NEW.context_hash,NEW.manifest_id,NEW.reason,NEW.created_by_user_id,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.company_id,OLD.proposal_type,OLD.context_json,OLD.initiative_context_json,OLD.context_hash,OLD.manifest_id,OLD.reason,OLD.created_by_user_id,OLD.created_at)
    OR OLD.status NOT IN ('proposed','under_review') OR NEW.revision<>OLD.revision+1 OR NEW.reviewed_by_user_id IS NULL
    OR length(trim(NEW.review_rationale))<10 OR length(NEW.review_rationale)>4000
    OR NOT ((OLD.status='proposed' AND NEW.status IN ('under_review','rejected','cancelled')) OR (OLD.status='under_review' AND NEW.status IN ('accepted','rejected','cancelled'))) THEN
    RAISE EXCEPTION 'initiative_immutable_material_and_native_review_required' USING ERRCODE='23514'; END IF;
  ELSIF NEW.status<>'proposed' OR NEW.revision<>1 OR NEW.reviewed_by_user_id IS NOT NULL OR NEW.review_rationale IS NOT NULL THEN
   RAISE EXCEPTION 'initiative_initial_proposal_required' USING ERRCODE='23514';
  END IF;
  SELECT * INTO m FROM analytical_lineage_manifests WHERE company_id=NEW.company_id AND id=NEW.manifest_id;
  IF m.id IS NULL OR m.analysis_type<>'initiative_planning_proposal' OR m.analysis_ref<>NEW.id OR m.engine_version<>'aw-native-initiative-planning-v1'
   OR m.definition_hash IS DISTINCT FROM NEW.context_hash OR m.input_hash IS DISTINCT FROM NEW.initiative_context_json->>'snapshotHash'
   OR m.requested_by IS DISTINCT FROM NEW.created_by_user_id OR m.created_at<>NEW.created_at OR m.parameters_json->>'signature' IS NULL
   OR m.expires_at<>(NEW.initiative_context_json->>'expiresAt')::timestamptz
   OR NEW.initiative_context_json->>'authority' IS DISTINCT FROM 'human_initiative_review_required'
   OR NEW.initiative_context_json->'result'->>'authority' IS DISTINCT FROM 'human_initiative_review_required'
   OR NEW.initiative_context_json->'result'->>'optimality' IS DISTINCT FROM 'not_proven'
   OR ((NEW.initiative_context_json->'profile') - 'initiatives'::text - 'initiativePolicy'::text) IS DISTINCT FROM NEW.context_json->'profile'
   OR NEW.initiative_context_json->>'jointSnapshotHash' IS DISTINCT FROM NEW.context_json->>'snapshotHash'
   OR jsonb_array_length(NEW.context_json->'profile'->'projects') NOT BETWEEN 2 AND 20
   OR jsonb_array_length(NEW.context_json->'profile'->'tasks') NOT BETWEEN 1 AND 200
   OR jsonb_array_length(NEW.context_json->'sourceSnapshots')<>jsonb_array_length(NEW.context_json->'profile'->'projects')
   OR jsonb_array_length(NEW.initiative_context_json->'result'->'candidates')<>jsonb_array_length(NEW.context_json->'profile'->'projects')
   OR (SELECT count(DISTINCT value->>'projectId') FROM jsonb_array_elements(NEW.initiative_context_json->'result'->'candidates'))<>jsonb_array_length(NEW.context_json->'profile'->'projects')
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.initiative_context_json->'result'->'candidates') c WHERE c->>'disposition' NOT IN ('start','continue','pause','stop','investigate') OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.context_json->'profile'->'projects') j WHERE j->>'id'=c->>'projectId'))
   OR jsonb_array_length(NEW.applied_roadmap_refs_json)<>0
   OR (NEW.status<>'accepted' AND jsonb_array_length(NEW.applied_project_refs_json)<>0) THEN
   RAISE EXCEPTION 'initiative_exact_native_material_required' USING ERRCODE='23514'; END IF;
  IF NEW.status IN ('proposed','under_review','accepted') AND m.expires_at<=clock_timestamp() THEN
   RAISE EXCEPTION 'initiative_expired_source_denied' USING ERRCODE='23514'; END IF;
  IF NEW.status='accepted' THEN
   IF NOT EXISTS(SELECT 1 FROM instance_settings WHERE singleton_key='default' AND experimental->>'planning_optimizer_v8'='true' AND experimental->>'adaptive_planning_v8'='true')
    OR jsonb_array_length(NEW.applied_project_refs_json)<>(SELECT count(*) FROM jsonb_array_elements(NEW.initiative_context_json->'result'->'candidates') c WHERE c->>'disposition'<>'investigate')
    OR (SELECT count(DISTINCT value->>'projectId') FROM jsonb_array_elements(NEW.applied_project_refs_json))<>jsonb_array_length(NEW.applied_project_refs_json) THEN
    RAISE EXCEPTION 'initiative_exact_canonical_owner_refs_required' USING ERRCODE='23514'; END IF;
   FOR ref IN SELECT value FROM jsonb_array_elements(NEW.applied_project_refs_json) LOOP
    SELECT value INTO candidate FROM jsonb_array_elements(NEW.initiative_context_json->'result'->'candidates') c WHERE c->>'projectId'=ref->>'projectId';
    SELECT * INTO native_project FROM projects WHERE company_id=NEW.company_id AND id=(ref->>'projectId')::uuid;
    IF candidate IS NULL OR candidate->>'disposition'='investigate' OR candidate->>'disposition' IS DISTINCT FROM ref->>'disposition'
     OR native_project.id IS NULL OR native_project.status IS DISTINCT FROM ref->>'status' OR date_trunc('milliseconds',native_project.updated_at) IS DISTINCT FROM (ref->>'updatedAt')::timestamptz
     OR (native_project.paused_at IS NOT NULL) IS DISTINCT FROM (ref->>'paused')::boolean
     OR (candidate->>'disposition' IN ('start','continue') AND (native_project.status<>'in_progress' OR native_project.paused_at IS NOT NULL))
     OR (candidate->>'disposition'='pause' AND (native_project.status<>'in_progress' OR native_project.paused_at IS NULL OR native_project.pause_reason IS DISTINCT FROM 'manual'))
     OR (candidate->>'disposition'='stop' AND (native_project.status<>'cancelled' OR native_project.paused_at IS NULL OR native_project.pause_reason IS DISTINCT FROM 'manual')) THEN
     RAISE EXCEPTION 'initiative_original_project_owner_application_required' USING ERRCODE='23514'; END IF;
   END LOOP;
  END IF;
  RETURN NEW;
 END IF;
 IF NEW.initiative_context_json IS NOT NULL OR NEW.applied_project_refs_json<>'[]'::jsonb THEN
  RAISE EXCEPTION 'joint_schedule_cannot_apply_initiative_changes' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.id,NEW.company_id,NEW.proposal_type,NEW.context_json,NEW.context_hash,NEW.manifest_id,NEW.reason,NEW.created_by_user_id,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.id,OLD.company_id,OLD.proposal_type,OLD.context_json,OLD.context_hash,OLD.manifest_id,OLD.reason,OLD.created_by_user_id,OLD.created_at)
   OR OLD.status NOT IN ('proposed','under_review') OR NEW.revision<>OLD.revision+1 OR NEW.reviewed_by_user_id IS NULL
   OR length(trim(NEW.review_rationale))<10 OR length(NEW.review_rationale)>4000
   OR NOT ((OLD.status='proposed' AND NEW.status IN ('under_review','rejected','cancelled')) OR (OLD.status='under_review' AND NEW.status IN ('accepted','rejected','cancelled'))) THEN
   RAISE EXCEPTION 'cross_project_planning_immutable_material_and_native_review_required' USING ERRCODE='23514'; END IF;
 ELSE
  IF NEW.status<>'proposed' OR NEW.revision<>1 OR NEW.reviewed_by_user_id IS NOT NULL OR NEW.review_rationale IS NOT NULL THEN
   RAISE EXCEPTION 'cross_project_planning_initial_proposal_required' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.status<>'accepted' AND jsonb_array_length(NEW.applied_roadmap_refs_json)<>0 THEN
  RAISE EXCEPTION 'cross_project_planning_unapproved_application_denied' USING ERRCODE='23514'; END IF;
 SELECT * INTO m FROM analytical_lineage_manifests WHERE company_id=NEW.company_id AND id=NEW.manifest_id;
 IF m.id IS NULL OR m.analysis_type<>'cross_project_planning_proposal' OR m.analysis_ref<>NEW.id OR m.engine_version<>'aw-native-cross-project-planning-v1'
  OR m.definition_hash IS DISTINCT FROM NEW.context_hash OR m.input_hash IS DISTINCT FROM NEW.context_json->>'snapshotHash'
  OR m.requested_by IS DISTINCT FROM NEW.created_by_user_id OR m.created_at<>NEW.created_at OR m.parameters_json->>'signature' IS NULL
  OR m.expires_at<>(NEW.context_json->>'expiresAt')::timestamptz
  OR NEW.context_json->>'authority' IS DISTINCT FROM 'human_cross_project_roadmap_review_required'
  OR NEW.context_json->'result'->>'status' IS DISTINCT FROM 'feasible_best_known' OR NEW.context_json->'result'->>'optimality' IS DISTINCT FROM 'not_proven'
  OR jsonb_array_length(NEW.context_json->'profile'->'projects') NOT BETWEEN 2 AND 20
  OR jsonb_array_length(NEW.context_json->'profile'->'tasks') NOT BETWEEN 1 AND 200
  OR jsonb_array_length(NEW.context_json->'sourceSnapshots')<>jsonb_array_length(NEW.context_json->'profile'->'projects') THEN
  RAISE EXCEPTION 'cross_project_planning_exact_native_material_required' USING ERRCODE='23514'; END IF;
 IF NEW.status IN ('proposed','under_review','accepted') AND m.expires_at<=clock_timestamp() THEN
  RAISE EXCEPTION 'cross_project_planning_expired_source_denied' USING ERRCODE='23514'; END IF;
 IF NEW.status='accepted' THEN
  IF jsonb_array_length(NEW.applied_roadmap_refs_json)<>jsonb_array_length(NEW.context_json->'sourceSnapshots')
   OR NOT EXISTS(SELECT 1 FROM instance_settings WHERE singleton_key='default' AND experimental->>'planning_optimizer_v8'='true' AND experimental->>'adaptive_planning_v8'='true')
   OR (SELECT count(DISTINCT value->>'projectId') FROM jsonb_array_elements(NEW.applied_roadmap_refs_json))<>jsonb_array_length(NEW.applied_roadmap_refs_json) THEN
   RAISE EXCEPTION 'cross_project_planning_exact_applied_owners_required' USING ERRCODE='23514'; END IF;
  start_at:=((NEW.context_json->'profile'->'horizon'->>'start') || 'T00:00:00Z')::timestamptz;
  FOR ref IN SELECT value FROM jsonb_array_elements(NEW.applied_roadmap_refs_json) LOOP
   SELECT * INTO child FROM project_roadmap_proposals WHERE company_id=NEW.company_id AND id=(ref->>'proposalId')::uuid AND project_id=(ref->>'projectId')::uuid;
   IF child.id IS NULL OR child.status<>'accepted' OR child.reviewed_by_user_id IS DISTINCT FROM NEW.reviewed_by_user_id
    OR child.created_by_user_id IS DISTINCT FROM NEW.reviewed_by_user_id OR child.created_by_agent_id IS NOT NULL
    OR jsonb_array_length(child.patch_json->'changes')<>(SELECT jsonb_array_length(s->'tasks') FROM jsonb_array_elements(NEW.context_json->'sourceSnapshots') s WHERE s->>'projectId'=ref->>'projectId')
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.context_json->'sourceSnapshots') s WHERE s->>'projectId'=ref->>'projectId') THEN
    RAISE EXCEPTION 'cross_project_planning_original_human_roadmap_owner_required' USING ERRCODE='23514'; END IF;
   FOR item IN SELECT value FROM jsonb_array_elements(child.patch_json->'changes') LOOP
    SELECT value INTO scheduled FROM jsonb_array_elements(NEW.context_json->'result'->'schedule') s WHERE s->>'taskKey'=item->>'issueId';
    IF scheduled IS NULL OR NOT EXISTS(SELECT 1 FROM issues i WHERE i.company_id=NEW.company_id AND i.project_id=child.project_id AND i.id::text=item->>'issueId'
       AND i.planned_start_at=start_at+(scheduled->>'startDay')::integer*interval '1 day'
       AND i.planned_end_at=start_at+(scheduled->>'endDay')::integer*interval '1 day') THEN
     RAISE EXCEPTION 'cross_project_planning_exact_canonical_application_required' USING ERRCODE='23514'; END IF;
   END LOOP;
  END LOOP;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION aw_initiative_goal_lineage_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p adaptive_planning_proposals%ROWTYPE;
BEGIN
 SELECT * INTO p FROM adaptive_planning_proposals WHERE company_id=NEW.company_id AND id=NEW.id;
 IF p.id IS NULL OR p.proposal_type<>'prioritize_initiatives' THEN RETURN NEW; END IF;
 IF jsonb_array_length(p.initiative_context_json->'sourcePins'->'goalIds')>320
  OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p.initiative_context_json->'sourcePins'->'goalIds') g WHERE NOT EXISTS(SELECT 1 FROM analytical_lineage_edges e WHERE e.company_id=p.company_id AND e.manifest_id=p.manifest_id AND e.input_type='goal' AND e.input_ref::text=g)) THEN
  RAISE EXCEPTION 'initiative_complete_native_goal_sources_required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER aw_initiative_goal_lineage_complete AFTER INSERT OR UPDATE ON adaptive_planning_proposals DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION aw_initiative_goal_lineage_complete();

--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_analytical_edge_admission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('business-events:' || NEW.company_id::text, 0));
  IF EXISTS(SELECT 1 FROM analytical_source_suppressions s WHERE s.company_id=NEW.company_id AND s.input_type=NEW.input_type AND s.input_ref=NEW.input_ref) THEN
    RAISE EXCEPTION 'Analytical source was erased' USING ERRCODE='23514';
  END IF;
  IF NOT (CASE NEW.input_type
    WHEN 'issue' THEN EXISTS(SELECT 1 FROM issues WHERE company_id=NEW.company_id AND id=NEW.input_ref)
    WHEN 'goal' THEN EXISTS(SELECT 1 FROM goals WHERE company_id=NEW.company_id AND id=NEW.input_ref)
    WHEN 'project' THEN EXISTS(SELECT 1 FROM projects WHERE company_id=NEW.company_id AND id=NEW.input_ref)
    WHEN 'metric_version' THEN EXISTS(SELECT 1 FROM business_metric_versions WHERE company_id=NEW.company_id AND id=NEW.input_ref)
    WHEN 'business_event_source' THEN EXISTS(SELECT 1 FROM business_events e JOIN activity_log a ON a.company_id=e.company_id AND a.id=e.source_ref
      WHERE e.company_id=NEW.company_id AND e.source_ref=NEW.input_ref AND e.source_hash=NEW.input_hash
        AND e.tombstoned_at IS NULL AND e.expires_at>now() AND e.source_version='aw-activity-v2'
        AND NOT EXISTS(SELECT 1 FROM business_event_suppressions s WHERE s.company_id=e.company_id AND s.source_ref=e.source_ref))
    WHEN 'governance_obligation' THEN EXISTS(SELECT 1 FROM governance_obligations WHERE company_id=NEW.company_id AND id=NEW.input_ref)
    ELSE false END) THEN
    RAISE EXCEPTION 'Analytical source is unavailable in this company' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
