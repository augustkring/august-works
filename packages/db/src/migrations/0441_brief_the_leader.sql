CREATE TABLE "adaptive_planning_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"proposal_type" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"context_json" jsonb NOT NULL,
	"context_hash" text NOT NULL,
	"manifest_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"reviewed_by_user_id" text,
	"review_rationale" text,
	"applied_roadmap_refs_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "adaptive_planning_proposals_tenant_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "adaptive_planning_proposals_state_check" CHECK ("adaptive_planning_proposals"."proposal_type"='change_schedule' and "adaptive_planning_proposals"."status" in ('proposed','under_review','accepted','rejected','cancelled') and "adaptive_planning_proposals"."revision">0),
	CONSTRAINT "adaptive_planning_proposals_hash_check" CHECK ("adaptive_planning_proposals"."context_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "adaptive_planning_proposals" ADD CONSTRAINT "adaptive_planning_proposals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adaptive_planning_proposals" ADD CONSTRAINT "adaptive_planning_proposals_manifest_fk" FOREIGN KEY ("company_id","manifest_id") REFERENCES "public"."analytical_lineage_manifests"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "adaptive_planning_proposals_company_idx" ON "adaptive_planning_proposals" USING btree ("company_id","id");--> statement-breakpoint
CREATE FUNCTION aw_cross_project_planning_material_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m analytical_lineage_manifests%ROWTYPE; ref jsonb; item jsonb; scheduled jsonb; child project_roadmap_proposals%ROWTYPE; start_at timestamptz;
BEGIN
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
CREATE TRIGGER aw_cross_project_planning_material_guard BEFORE INSERT OR UPDATE ON adaptive_planning_proposals FOR EACH ROW EXECUTE FUNCTION aw_cross_project_planning_material_guard();
--> statement-breakpoint
CREATE FUNCTION aw_cross_project_planning_lineage_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p adaptive_planning_proposals%ROWTYPE; m analytical_lineage_manifests%ROWTYPE;
BEGIN
 SELECT * INTO p FROM adaptive_planning_proposals WHERE company_id=NEW.company_id AND id=NEW.id;
 IF p.id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO m FROM analytical_lineage_manifests WHERE company_id=p.company_id AND id=p.manifest_id;
 IF m.id IS NULL OR m.source_count<>(SELECT count(*) FROM analytical_lineage_edges WHERE company_id=p.company_id AND manifest_id=m.id)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(p.context_json->'profile'->'projects') j WHERE NOT EXISTS(SELECT 1 FROM analytical_lineage_edges e WHERE e.company_id=p.company_id AND e.manifest_id=m.id AND e.input_type='project' AND e.input_ref::text=j->>'id'))
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(p.context_json->'profile'->'tasks') j WHERE NOT EXISTS(SELECT 1 FROM analytical_lineage_edges e WHERE e.company_id=p.company_id AND e.manifest_id=m.id AND e.input_type='issue' AND e.input_ref::text=j->>'key')) THEN
  RAISE EXCEPTION 'cross_project_planning_complete_native_sources_required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER aw_cross_project_planning_lineage_complete AFTER INSERT OR UPDATE ON adaptive_planning_proposals DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION aw_cross_project_planning_lineage_complete();
