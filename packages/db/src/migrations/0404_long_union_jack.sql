CREATE TABLE "business_experiment_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"experiment_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"unit_type" text NOT NULL,
	"unit_id" uuid NOT NULL,
	"issue_id" uuid,
	"project_id" uuid,
	"arm" text NOT NULL,
	"source_snapshot_json" jsonb NOT NULL,
	"source_hash" text NOT NULL,
	"invariant_receipts_json" jsonb NOT NULL,
	"lineage_manifest_id" uuid NOT NULL,
	"receipt_hash" text NOT NULL,
	"signature" text NOT NULL,
	"assigned_by" text NOT NULL,
	"assigned_at" timestamp with time zone NOT NULL,
	CONSTRAINT "business_experiment_assignments_tenant_uq" UNIQUE("company_id","experiment_id","version_id","id"),
	CONSTRAINT "business_experiment_assignments_unit_uq" UNIQUE("company_id","version_id","unit_id"),
	CONSTRAINT "business_experiment_assignments_content_check" CHECK ("business_experiment_assignments"."arm" in ('control','treatment') and ("business_experiment_assignments"."unit_type"='issue' and "business_experiment_assignments"."issue_id"="business_experiment_assignments"."unit_id" and "business_experiment_assignments"."project_id" is null or "business_experiment_assignments"."unit_type"='project' and "business_experiment_assignments"."project_id"="business_experiment_assignments"."unit_id" and "business_experiment_assignments"."issue_id" is null) and "business_experiment_assignments"."source_hash" ~ '^[0-9a-f]{64}$' and "business_experiment_assignments"."receipt_hash" ~ '^[0-9a-f]{64}$' and "business_experiment_assignments"."signature" ~ '^decision-spec-v1.[0-9a-f]{64}$' and jsonb_typeof("business_experiment_assignments"."source_snapshot_json")='object' and jsonb_typeof("business_experiment_assignments"."invariant_receipts_json")='array')
);
--> statement-breakpoint
CREATE TABLE "business_experiment_completions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"experiment_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"concurrent_change_review_json" jsonb NOT NULL,
	"rationale" text NOT NULL,
	"receipt_hash" text NOT NULL,
	"signature" text NOT NULL,
	"completed_by" text NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "business_experiment_completions_version_uq" UNIQUE("company_id","experiment_id","version_id"),
	CONSTRAINT "business_experiment_completions_content_check" CHECK ("business_experiment_completions"."reason" in ('fixed_horizon','emergency_safety_stop','cancelled') and jsonb_typeof("business_experiment_completions"."concurrent_change_review_json")='object' and "business_experiment_completions"."concurrent_change_review_json"->>'assessment' in ('none_identified','material_or_unknown') and length(btrim("business_experiment_completions"."concurrent_change_review_json"->>'rationale')) between 10 and 2000 and length(btrim("business_experiment_completions"."rationale")) between 10 and 2000 and "business_experiment_completions"."receipt_hash" ~ '^[0-9a-f]{64}$' and "business_experiment_completions"."signature" ~ '^decision-spec-v1.[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "business_experiment_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"experiment_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"review_transition_id" uuid NOT NULL,
	"assignment_key_fingerprint" text NOT NULL,
	"rationale" text NOT NULL,
	"receipt_hash" text NOT NULL,
	"signature" text NOT NULL,
	"started_by" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	CONSTRAINT "business_experiment_executions_version_uq" UNIQUE("company_id","experiment_id","version_id"),
	CONSTRAINT "business_experiment_executions_content_check" CHECK ("business_experiment_executions"."mode"='recording_only_human_attested_native_process' and "business_experiment_executions"."assignment_key_fingerprint" ~ '^[0-9a-f]{64}$' and "business_experiment_executions"."receipt_hash" ~ '^[0-9a-f]{64}$' and "business_experiment_executions"."signature" ~ '^decision-spec-v1.[0-9a-f]{64}$' and length(btrim("business_experiment_executions"."rationale")) between 10 and 2000)
);
--> statement-breakpoint
CREATE TABLE "business_experiment_exposures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"experiment_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"arm" text NOT NULL,
	"status" text NOT NULL,
	"provenance" text NOT NULL,
	"asserted_applied_at" timestamp with time zone,
	"rationale" text NOT NULL,
	"receipt_hash" text NOT NULL,
	"signature" text NOT NULL,
	"recorded_by" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "business_experiment_exposures_assignment_uq" UNIQUE("company_id","assignment_id"),
	CONSTRAINT "business_experiment_exposures_content_check" CHECK ("business_experiment_exposures"."arm" in ('control','treatment') and "business_experiment_exposures"."status" in ('applied','not_applied') and "business_experiment_exposures"."provenance"='human_attestation' and ("business_experiment_exposures"."status"='applied')=("business_experiment_exposures"."asserted_applied_at" is not null) and ("business_experiment_exposures"."asserted_applied_at" is null or "business_experiment_exposures"."asserted_applied_at"<="business_experiment_exposures"."recorded_at") and "business_experiment_exposures"."receipt_hash" ~ '^[0-9a-f]{64}$' and "business_experiment_exposures"."signature" ~ '^decision-spec-v1.[0-9a-f]{64}$' and length(btrim("business_experiment_exposures"."rationale")) between 10 and 2000)
);
--> statement-breakpoint
ALTER TABLE "business_experiment_assignments" ADD CONSTRAINT "business_experiment_assignments_execution_fk" FOREIGN KEY ("company_id","experiment_id","version_id") REFERENCES "public"."business_experiment_executions"("company_id","experiment_id","version_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_experiment_assignments" ADD CONSTRAINT "business_experiment_assignments_issue_fk" FOREIGN KEY ("company_id","issue_id") REFERENCES "public"."issues"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_experiment_assignments" ADD CONSTRAINT "business_experiment_assignments_project_fk" FOREIGN KEY ("company_id","project_id") REFERENCES "public"."projects"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_experiment_assignments" ADD CONSTRAINT "business_experiment_assignments_lineage_fk" FOREIGN KEY ("company_id","lineage_manifest_id") REFERENCES "public"."analytical_lineage_manifests"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_experiment_completions" ADD CONSTRAINT "business_experiment_completions_execution_fk" FOREIGN KEY ("company_id","experiment_id","version_id") REFERENCES "public"."business_experiment_executions"("company_id","experiment_id","version_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_experiment_executions" ADD CONSTRAINT "business_experiment_executions_version_fk" FOREIGN KEY ("company_id","experiment_id","version_id") REFERENCES "public"."business_experiment_versions"("company_id","experiment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_experiment_executions" ADD CONSTRAINT "business_experiment_executions_review_fk" FOREIGN KEY ("review_transition_id") REFERENCES "public"."business_experiment_transitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_experiment_exposures" ADD CONSTRAINT "business_experiment_exposures_assignment_fk" FOREIGN KEY ("company_id","experiment_id","version_id","assignment_id") REFERENCES "public"."business_experiment_assignments"("company_id","experiment_id","version_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_experiment_root_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.revision<>1 OR NEW.state<>'draft' OR NEW.current_version_id IS NOT NULL OR NEW.updated_at<>NEW.created_at THEN
   RAISE EXCEPTION 'experiment_initial_draft_required' USING ERRCODE='23514'; END IF;
 ELSE
  IF ROW(NEW.id,NEW.company_id,NEW.experiment_key,NEW.created_by,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.company_id,OLD.experiment_key,OLD.created_by,OLD.created_at) THEN
   RAISE EXCEPTION 'experiment_root_identity_immutable' USING ERRCODE='23514'; END IF;
  IF OLD.current_version_id IS NULL AND OLD.revision=1 AND OLD.state='draft' THEN
   IF NEW.revision<>1 OR NEW.state<>'draft' OR NEW.current_version_id IS NULL OR NEW.updated_at<>OLD.updated_at THEN
    RAISE EXCEPTION 'experiment_initial_version_required' USING ERRCODE='23514'; END IF;
  ELSIF NEW.revision<>OLD.revision+1 OR NEW.updated_at<OLD.updated_at OR OLD.state NOT IN ('draft','in_review','ready','running','paused','completed','analyzing') THEN
   RAISE EXCEPTION 'experiment_revision_transition_not_admitted' USING ERRCODE='23514';
  ELSIF NEW.current_version_id IS DISTINCT FROM OLD.current_version_id THEN
   IF OLD.state NOT IN ('draft','in_review','ready') OR NEW.state<>'draft' OR NOT EXISTS(SELECT 1 FROM business_experiment_versions WHERE company_id=NEW.company_id AND experiment_id=NEW.id AND id=NEW.current_version_id AND revision=NEW.revision AND created_at=NEW.updated_at) THEN
    RAISE EXCEPTION 'experiment_explicit_amendment_required' USING ERRCODE='23514'; END IF;
  ELSIF NOT EXISTS(SELECT 1 FROM business_experiment_transitions WHERE company_id=NEW.company_id AND experiment_id=NEW.id AND version_id=NEW.current_version_id AND revision=NEW.revision
   AND from_state=OLD.state AND to_state=NEW.state AND created_at=NEW.updated_at) THEN
   RAISE EXCEPTION 'experiment_exact_transition_receipt_required' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_experiment_transition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r business_experiments%ROWTYPE; v business_experiment_versions%ROWTYPE; c business_experiment_completions%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM business_experiment_versions WHERE company_id=OLD.company_id AND id=OLD.version_id) THEN
   RAISE EXCEPTION 'experiment_transition_immutable' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'experiment_transition_immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO r FROM business_experiments WHERE company_id=NEW.company_id AND id=NEW.experiment_id;
 SELECT * INTO v FROM business_experiment_versions WHERE company_id=NEW.company_id AND experiment_id=NEW.experiment_id AND id=NEW.version_id;
 IF r.id IS NULL OR v.id IS NULL OR r.current_version_id<>NEW.version_id OR r.revision+1<>NEW.revision OR r.state<>NEW.from_state OR r.updated_at>NEW.created_at THEN
  RAISE EXCEPTION 'experiment_exact_current_transition_required' USING ERRCODE='23514'; END IF;
 IF NEW.from_state IN ('draft','in_review','ready') AND NEW.to_state IN ('draft','in_review','ready','cancelled') THEN
  IF NOT (NEW.from_state='draft' AND NEW.to_state IN ('in_review','cancelled') OR NEW.from_state='in_review' AND NEW.to_state IN ('draft','ready','cancelled') OR NEW.from_state='ready' AND NEW.to_state IN ('in_review','cancelled'))
   OR NEW.to_state<>'cancelled' AND (NEW.created_at>=(v.definition_json->'sampleOrDurationPlan'->>'from')::timestamptz OR NEW.created_at>=v.expires_at)
   OR NEW.to_state='ready' AND (v.definition_json->'sampleOrDurationPlan'->>'until')::timestamptz>=v.expires_at THEN
    RAISE EXCEPTION 'experiment_human_preregistration_transition_required' USING ERRCODE='23514'; END IF;
 ELSIF NEW.from_state='ready' AND NEW.to_state='running' THEN
  IF NOT EXISTS(SELECT 1 FROM business_experiment_executions WHERE company_id=NEW.company_id AND experiment_id=NEW.experiment_id AND version_id=NEW.version_id AND started_at=NEW.created_at)
   OR EXISTS(SELECT 1 FROM business_experiments WHERE company_id=NEW.company_id AND id<>NEW.experiment_id AND state IN ('running','paused')) THEN
    RAISE EXCEPTION 'experiment_exact_nonconcurrent_recording_required' USING ERRCODE='23514'; END IF;
 ELSIF NEW.from_state IN ('running','paused') THEN
  IF NOT (NEW.from_state='running' AND NEW.to_state IN ('paused','completed','cancelled') OR NEW.from_state='paused' AND NEW.to_state IN ('running','completed','cancelled'))
   OR NOT EXISTS(SELECT 1 FROM business_experiment_executions WHERE company_id=NEW.company_id AND experiment_id=NEW.experiment_id AND version_id=NEW.version_id AND started_at<=NEW.created_at)
   OR NEW.to_state='running' AND NEW.created_at>=(v.definition_json->'sampleOrDurationPlan'->>'until')::timestamptz THEN
    RAISE EXCEPTION 'experiment_exact_recording_control_required' USING ERRCODE='23514'; END IF;
  IF NEW.to_state IN ('completed','cancelled') THEN
   SELECT * INTO c FROM business_experiment_completions WHERE company_id=NEW.company_id AND experiment_id=NEW.experiment_id AND version_id=NEW.version_id;
   IF c.id IS NULL OR c.completed_at<>NEW.created_at OR (NEW.to_state='cancelled') IS DISTINCT FROM (c.reason='cancelled') THEN
    RAISE EXCEPTION 'experiment_exact_stopping_receipt_required' USING ERRCODE='23514'; END IF;
  END IF;
 ELSE RAISE EXCEPTION 'experiment_transition_owner_unqualified' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION aw_experiment_execution_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r business_experiments%ROWTYPE; v business_experiment_versions%ROWTYPE; review business_experiment_transitions%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM business_experiment_versions WHERE company_id=OLD.company_id AND id=OLD.version_id) THEN
   RAISE EXCEPTION 'experiment_execution_immutable' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'experiment_execution_immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO r FROM business_experiments WHERE company_id=NEW.company_id AND id=NEW.experiment_id;
 SELECT * INTO v FROM business_experiment_versions WHERE company_id=NEW.company_id AND experiment_id=NEW.experiment_id AND id=NEW.version_id;
 SELECT * INTO review FROM business_experiment_transitions WHERE id=NEW.review_transition_id AND company_id=NEW.company_id AND experiment_id=NEW.experiment_id AND version_id=NEW.version_id;
 IF r.id IS NULL OR v.id IS NULL OR review.id IS NULL OR r.state<>'ready' OR r.current_version_id<>NEW.version_id OR r.revision<>review.revision OR review.to_state<>'ready'
  OR review.created_at>NEW.started_at OR review.created_at>=(v.definition_json->'sampleOrDurationPlan'->>'from')::timestamptz
  OR NEW.started_at>=(v.definition_json->'sampleOrDurationPlan'->>'until')::timestamptz OR NEW.started_at>=v.expires_at
  OR v.definition_json->'executionPlan' IS DISTINCT FROM '{"mode":"recording_only_human_attested_native_process","exposureProvenance":"human_attestation","exposureTimeSemantics":"human_asserted_event_time","outcomeTimeSemantics":"created_in_window_current_state_at_common_final_capture"}'::jsonb
  OR NEW.signature !~ '^decision-spec-v1[.][0-9a-f]{64}$'
  OR EXISTS(SELECT 1 FROM business_experiments WHERE company_id=NEW.company_id AND id<>NEW.experiment_id AND state IN ('running','paused')) THEN
   RAISE EXCEPTION 'experiment_exact_reviewed_recording_required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_experiment_execution_guard BEFORE INSERT OR UPDATE OR DELETE ON business_experiment_executions FOR EACH ROW EXECUTE FUNCTION aw_experiment_execution_guard();
--> statement-breakpoint
CREATE FUNCTION aw_experiment_execution_proof_required() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE review_revision integer;
BEGIN
 SELECT revision INTO review_revision FROM business_experiment_transitions WHERE id=NEW.review_transition_id AND company_id=NEW.company_id AND experiment_id=NEW.experiment_id AND version_id=NEW.version_id;
 IF EXISTS(SELECT 1 FROM business_experiment_executions WHERE id=NEW.id) AND NOT EXISTS(SELECT 1 FROM business_experiment_transitions WHERE company_id=NEW.company_id AND experiment_id=NEW.experiment_id AND version_id=NEW.version_id AND revision=review_revision+1 AND from_state='ready' AND to_state='running' AND created_at=NEW.started_at) THEN
  RAISE EXCEPTION 'experiment_execution_must_advance_owner' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER aw_experiment_execution_proof_required AFTER INSERT ON business_experiment_executions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION aw_experiment_execution_proof_required();
--> statement-breakpoint
CREATE FUNCTION aw_experiment_assignment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r business_experiments%ROWTYPE; v business_experiment_versions%ROWTYPE; i issues%ROWTYPE; p projects%ROWTYPE; invariant jsonb; metric business_metric_versions%ROWTYPE; pin jsonb; expected_value integer; expected_count integer;
BEGIN
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM business_experiment_versions WHERE company_id=OLD.company_id AND id=OLD.version_id)
   AND EXISTS(SELECT 1 FROM analytical_lineage_manifests WHERE company_id=OLD.company_id AND id=OLD.lineage_manifest_id)
   AND (OLD.unit_type='issue' AND EXISTS(SELECT 1 FROM issues WHERE company_id=OLD.company_id AND id=OLD.unit_id) OR OLD.unit_type='project' AND EXISTS(SELECT 1 FROM projects WHERE company_id=OLD.company_id AND id=OLD.unit_id)) THEN
    RAISE EXCEPTION 'experiment_assignment_immutable' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'experiment_assignment_immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO r FROM business_experiments WHERE company_id=NEW.company_id AND id=NEW.experiment_id;
 SELECT * INTO v FROM business_experiment_versions WHERE company_id=NEW.company_id AND experiment_id=NEW.experiment_id AND id=NEW.version_id;
 IF r.id IS NULL OR v.id IS NULL OR r.state<>'running' OR r.current_version_id<>NEW.version_id
  OR NEW.unit_type IS DISTINCT FROM v.definition_json->'population'->>'randomizationUnit'
  OR NEW.assigned_at<(v.definition_json->'sampleOrDurationPlan'->>'from')::timestamptz OR NEW.assigned_at>=(v.definition_json->'sampleOrDurationPlan'->>'until')::timestamptz OR NEW.assigned_at>=v.expires_at
  OR NEW.signature !~ '^decision-spec-v1[.][0-9a-f]{64}$'
  OR NOT EXISTS(SELECT 1 FROM business_experiment_executions WHERE company_id=NEW.company_id AND experiment_id=NEW.experiment_id AND version_id=NEW.version_id AND started_at<=NEW.assigned_at)
  OR (SELECT count(*) FROM business_experiment_assignments WHERE company_id=NEW.company_id AND version_id=NEW.version_id)>=(v.definition_json->'sampleOrDurationPlan'->>'maximumAssignedUnits')::integer
  OR NEW.source_snapshot_json->>'id' IS DISTINCT FROM NEW.unit_id::text OR NEW.source_snapshot_json->>'entity' IS DISTINCT FROM NEW.unit_type
  OR NOT EXISTS(SELECT 1 FROM analytical_lineage_manifests WHERE company_id=NEW.company_id AND id=NEW.lineage_manifest_id AND engine_version='aw-native-business-experiment-owner-v1' AND analysis_type='experiment_assignment' AND analysis_ref=NEW.id
   AND definition_hash=v.content_hash AND input_hash=NEW.source_hash AND parameters_json->>'receiptHash'=NEW.receipt_hash AND created_at=NEW.assigned_at AND expires_at=v.expires_at)
  OR NOT EXISTS(SELECT 1 FROM analytical_lineage_edges WHERE company_id=NEW.company_id AND manifest_id=NEW.lineage_manifest_id AND input_type=NEW.unit_type AND input_ref=NEW.unit_id AND relationship='source') THEN
    RAISE EXCEPTION 'experiment_exact_native_assignment_required' USING ERRCODE='23514'; END IF;
 IF NEW.unit_type='issue' THEN
  SELECT * INTO i FROM issues WHERE company_id=NEW.company_id AND id=NEW.unit_id;
  IF i.id IS NULL OR i.hidden_at IS NOT NULL OR NEW.source_snapshot_json->>'status' IS DISTINCT FROM i.status OR NEW.source_snapshot_json->'projectId' IS DISTINCT FROM coalesce(to_jsonb(i.project_id),'null'::jsonb)
   OR (NEW.source_snapshot_json->>'createdAt')::timestamptz<>date_trunc('milliseconds',i.created_at) OR (NEW.source_snapshot_json->>'updatedAt')::timestamptz<>date_trunc('milliseconds',i.updated_at)
   OR v.definition_json->'scope'->>'type'='project' AND i.project_id::text IS DISTINCT FROM v.definition_json->'scope'->>'id' THEN
    RAISE EXCEPTION 'experiment_exact_native_issue_snapshot_required' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO p FROM projects WHERE company_id=NEW.company_id AND id=NEW.unit_id;
  IF p.id IS NULL OR p.archived_at IS NOT NULL OR NEW.source_snapshot_json->>'status' IS DISTINCT FROM p.status OR NEW.source_snapshot_json->'projectId' IS DISTINCT FROM 'null'::jsonb
   OR (NEW.source_snapshot_json->>'createdAt')::timestamptz<>date_trunc('milliseconds',p.created_at) OR (NEW.source_snapshot_json->>'updatedAt')::timestamptz<>date_trunc('milliseconds',p.updated_at) THEN
    RAISE EXCEPTION 'experiment_exact_native_project_snapshot_required' USING ERRCODE='23514'; END IF;
 END IF;
 IF (NEW.source_snapshot_json->>'createdAt')::timestamptz<(v.definition_json->'sampleOrDurationPlan'->>'from')::timestamptz OR (NEW.source_snapshot_json->>'createdAt')::timestamptz>=(v.definition_json->'sampleOrDurationPlan'->>'until')::timestamptz THEN
  RAISE EXCEPTION 'experiment_unit_outside_registered_population' USING ERRCODE='23514'; END IF;
 expected_count=(SELECT count(*) FROM jsonb_array_elements(v.metric_pins_json) metric_declaration WHERE metric_declaration->>'role'='invariant');
 IF jsonb_array_length(NEW.invariant_receipts_json)<>expected_count OR (SELECT count(DISTINCT x->>'key') FROM jsonb_array_elements(NEW.invariant_receipts_json) x)<>expected_count THEN
  RAISE EXCEPTION 'experiment_complete_pretreatment_invariants_required' USING ERRCODE='23514'; END IF;
 FOR invariant IN SELECT value FROM jsonb_array_elements(NEW.invariant_receipts_json) LOOP
  SELECT value INTO pin FROM jsonb_array_elements(v.metric_pins_json) WHERE value->>'role'='invariant' AND value->>'key'=invariant->>'key';
  SELECT * INTO metric FROM business_metric_versions WHERE company_id=NEW.company_id AND id=(invariant->>'metricVersionId')::uuid;
  expected_value=CASE WHEN metric.definition_json->'calculation'->'numerator'->'statuses' ? (NEW.source_snapshot_json->>'status') THEN 1 ELSE 0 END;
  IF pin IS NULL OR metric.id IS NULL OR invariant->>'metricId' IS DISTINCT FROM pin->>'metricId' OR invariant->>'metricVersionId' IS DISTINCT FROM pin->>'metricVersionId'
   OR invariant->'value' IS DISTINCT FROM to_jsonb(expected_value) OR (invariant->>'observedAt')::timestamptz<>NEW.assigned_at OR coalesce(invariant->>'inputHash','') !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'experiment_exact_pretreatment_invariant_required' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_experiment_assignment_guard BEFORE INSERT OR UPDATE OR DELETE ON business_experiment_assignments FOR EACH ROW EXECUTE FUNCTION aw_experiment_assignment_guard();
--> statement-breakpoint
CREATE FUNCTION aw_experiment_exposure_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a business_experiment_assignments%ROWTYPE; r business_experiments%ROWTYPE; v business_experiment_versions%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM business_experiment_assignments WHERE company_id=OLD.company_id AND id=OLD.assignment_id) THEN
   RAISE EXCEPTION 'experiment_exposure_immutable' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'experiment_exposure_immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO a FROM business_experiment_assignments WHERE company_id=NEW.company_id AND experiment_id=NEW.experiment_id AND version_id=NEW.version_id AND id=NEW.assignment_id;
 SELECT * INTO r FROM business_experiments WHERE company_id=NEW.company_id AND id=NEW.experiment_id;
 SELECT * INTO v FROM business_experiment_versions WHERE company_id=NEW.company_id AND id=NEW.version_id;
 IF a.id IS NULL OR r.id IS NULL OR v.id IS NULL OR r.current_version_id<>NEW.version_id OR r.state NOT IN ('running','paused','completed')
  OR NEW.arm<>a.arm OR NEW.recorded_at<a.assigned_at OR NEW.provenance<>'human_attestation' OR NEW.signature !~ '^decision-spec-v1[.][0-9a-f]{64}$'
  OR NEW.asserted_applied_at IS NOT NULL AND (NEW.asserted_applied_at<a.assigned_at OR NEW.asserted_applied_at>NEW.recorded_at OR NEW.asserted_applied_at>=(v.definition_json->'sampleOrDurationPlan'->>'until')::timestamptz
   OR EXISTS(SELECT 1 FROM business_experiment_completions WHERE company_id=NEW.company_id AND version_id=NEW.version_id AND completed_at<NEW.asserted_applied_at)) THEN
   RAISE EXCEPTION 'experiment_exact_human_exposure_attestation_required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_experiment_exposure_guard BEFORE INSERT OR UPDATE OR DELETE ON business_experiment_exposures FOR EACH ROW EXECUTE FUNCTION aw_experiment_exposure_guard();
--> statement-breakpoint
CREATE FUNCTION aw_experiment_completion_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r business_experiments%ROWTYPE; v business_experiment_versions%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM business_experiment_executions WHERE company_id=OLD.company_id AND experiment_id=OLD.experiment_id AND version_id=OLD.version_id) THEN
   RAISE EXCEPTION 'experiment_completion_immutable' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'experiment_completion_immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO r FROM business_experiments WHERE company_id=NEW.company_id AND id=NEW.experiment_id;
 SELECT * INTO v FROM business_experiment_versions WHERE company_id=NEW.company_id AND id=NEW.version_id;
 IF r.id IS NULL OR v.id IS NULL OR r.current_version_id<>NEW.version_id OR r.state NOT IN ('running','paused') OR NEW.completed_at<r.updated_at
  OR NEW.signature !~ '^decision-spec-v1[.][0-9a-f]{64}$'
  OR NEW.reason='fixed_horizon' AND NEW.completed_at<(v.definition_json->'sampleOrDurationPlan'->>'until')::timestamptz THEN
    RAISE EXCEPTION 'experiment_exact_stopping_receipt_required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_experiment_completion_guard BEFORE INSERT OR UPDATE OR DELETE ON business_experiment_completions FOR EACH ROW EXECUTE FUNCTION aw_experiment_completion_guard();
--> statement-breakpoint
CREATE FUNCTION aw_experiment_completion_proof_required() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM business_experiment_completions WHERE id=NEW.id) AND NOT EXISTS(SELECT 1 FROM business_experiment_transitions WHERE company_id=NEW.company_id AND experiment_id=NEW.experiment_id AND version_id=NEW.version_id
  AND to_state=CASE WHEN NEW.reason='cancelled' THEN 'cancelled' ELSE 'completed' END AND created_at=NEW.completed_at) THEN
   RAISE EXCEPTION 'experiment_completion_must_advance_owner' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER aw_experiment_completion_proof_required AFTER INSERT ON business_experiment_completions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION aw_experiment_completion_proof_required();
--> statement-breakpoint
CREATE FUNCTION aw_experiment_assignment_erasure() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE version_manifest uuid;
BEGIN
 -- Dropping an enrolled subject cannot silently alter intent-to-treat evidence.
 -- Erase the source-dependent protocol and all its recording descendants.
 SELECT lineage_manifest_id INTO version_manifest FROM business_experiment_versions WHERE company_id=OLD.company_id AND id=OLD.version_id;
 IF version_manifest IS NOT NULL THEN DELETE FROM analytical_lineage_manifests WHERE company_id=OLD.company_id AND id=version_manifest; END IF;
 DELETE FROM analytical_lineage_manifests WHERE company_id=OLD.company_id AND id=OLD.lineage_manifest_id;
 RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_experiment_assignment_erasure AFTER DELETE ON business_experiment_assignments FOR EACH ROW EXECUTE FUNCTION aw_experiment_assignment_erasure();
