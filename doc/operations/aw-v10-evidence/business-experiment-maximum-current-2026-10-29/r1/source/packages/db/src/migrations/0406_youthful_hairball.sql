CREATE TABLE "business_experiment_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"experiment_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"definition_hash" text NOT NULL,
	"capture_json" jsonb NOT NULL,
	"result_json" jsonb NOT NULL,
	"invariant_diagnostics_json" jsonb NOT NULL,
	"receipt_hash" text NOT NULL,
	"signature" text NOT NULL,
	"analyzed_by" text NOT NULL,
	"analyzed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "business_experiment_analyses_tenant_uq" UNIQUE("company_id","experiment_id","version_id","id"),
	CONSTRAINT "business_experiment_analyses_version_uq" UNIQUE("company_id","experiment_id","version_id"),
	CONSTRAINT "business_experiment_analyses_content_check" CHECK ("business_experiment_analyses"."definition_hash" ~ '^[0-9a-f]{64}$' and "business_experiment_analyses"."receipt_hash" ~ '^[0-9a-f]{64}$' and "business_experiment_analyses"."signature" ~ '^decision-spec-v1[.][0-9a-f]{64}$' and jsonb_typeof("business_experiment_analyses"."capture_json")='object' and jsonb_typeof("business_experiment_analyses"."result_json")='object' and jsonb_typeof("business_experiment_analyses"."invariant_diagnostics_json")='array')
);
--> statement-breakpoint
CREATE TABLE "business_experiment_interpretations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"experiment_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"analysis_id" uuid NOT NULL,
	"conclusion" text NOT NULL,
	"rationale" text NOT NULL,
	"receipt_hash" text NOT NULL,
	"signature" text NOT NULL,
	"interpreted_by" text NOT NULL,
	"interpreted_at" timestamp with time zone NOT NULL,
	CONSTRAINT "business_experiment_interpretations_analysis_uq" UNIQUE("company_id","analysis_id"),
	CONSTRAINT "business_experiment_interpretations_content_check" CHECK ("business_experiment_interpretations"."conclusion" in ('ship_candidate','do_not_ship','iterate','abstain') and length(btrim("business_experiment_interpretations"."rationale")) between 10 and 2000 and "business_experiment_interpretations"."receipt_hash" ~ '^[0-9a-f]{64}$' and "business_experiment_interpretations"."signature" ~ '^decision-spec-v1[.][0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "business_experiment_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"experiment_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"analysis_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"metric_key" text NOT NULL,
	"metric_id" uuid NOT NULL,
	"metric_version_id" uuid NOT NULL,
	"value" integer NOT NULL,
	"source_snapshot_json" jsonb NOT NULL,
	"input_hash" text NOT NULL,
	"source_hash" text NOT NULL,
	"lineage_manifest_id" uuid NOT NULL,
	"receipt_hash" text NOT NULL,
	"signature" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	CONSTRAINT "business_experiment_outcomes_unit_key_uq" UNIQUE("company_id","analysis_id","assignment_id","metric_key"),
	CONSTRAINT "business_experiment_outcomes_content_check" CHECK ("business_experiment_outcomes"."value" in (0,1) and "business_experiment_outcomes"."input_hash" ~ '^[0-9a-f]{64}$' and "business_experiment_outcomes"."source_hash" ~ '^[0-9a-f]{64}$' and "business_experiment_outcomes"."receipt_hash" ~ '^[0-9a-f]{64}$' and "business_experiment_outcomes"."signature" ~ '^decision-spec-v1[.][0-9a-f]{64}$' and jsonb_typeof("business_experiment_outcomes"."source_snapshot_json")='object')
);
--> statement-breakpoint
ALTER TABLE "business_experiment_analyses" ADD CONSTRAINT "business_experiment_analyses_completion_fk" FOREIGN KEY ("company_id","experiment_id","version_id") REFERENCES "public"."business_experiment_completions"("company_id","experiment_id","version_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_experiment_interpretations" ADD CONSTRAINT "business_experiment_interpretations_analysis_fk" FOREIGN KEY ("company_id","experiment_id","version_id","analysis_id") REFERENCES "public"."business_experiment_analyses"("company_id","experiment_id","version_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_experiment_outcomes" ADD CONSTRAINT "business_experiment_outcomes_analysis_fk" FOREIGN KEY ("company_id","experiment_id","version_id","analysis_id") REFERENCES "public"."business_experiment_analyses"("company_id","experiment_id","version_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_experiment_outcomes" ADD CONSTRAINT "business_experiment_outcomes_assignment_fk" FOREIGN KEY ("company_id","experiment_id","version_id","assignment_id") REFERENCES "public"."business_experiment_assignments"("company_id","experiment_id","version_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_experiment_outcomes" ADD CONSTRAINT "business_experiment_outcomes_metric_fk" FOREIGN KEY ("company_id","metric_id","metric_version_id") REFERENCES "public"."business_metric_versions"("company_id","metric_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_experiment_outcomes" ADD CONSTRAINT "business_experiment_outcomes_lineage_fk" FOREIGN KEY ("company_id","lineage_manifest_id") REFERENCES "public"."analytical_lineage_manifests"("company_id","id") ON DELETE cascade ON UPDATE no action;
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
 ELSIF NEW.from_state='completed' AND NEW.to_state='analyzing' THEN
  IF NOT EXISTS(SELECT 1 FROM business_experiment_completions WHERE company_id=NEW.company_id AND experiment_id=NEW.experiment_id AND version_id=NEW.version_id AND reason<>'cancelled' AND completed_at<=NEW.created_at) THEN
   RAISE EXCEPTION 'experiment_exact_completed_analysis_required' USING ERRCODE='23514'; END IF;
 ELSIF NEW.from_state='analyzing' AND NEW.to_state IN ('decided','inconclusive','invalid') THEN
  IF NOT EXISTS(SELECT 1 FROM business_experiment_interpretations i JOIN business_experiment_analyses a ON a.id=i.analysis_id AND a.company_id=i.company_id
   WHERE i.company_id=NEW.company_id AND i.experiment_id=NEW.experiment_id AND i.version_id=NEW.version_id AND i.interpreted_at=NEW.created_at AND i.rationale=NEW.rationale
    AND NEW.to_state=CASE a.result_json->>'status' WHEN 'invalid' THEN 'invalid' WHEN 'inconclusive' THEN 'inconclusive' ELSE 'decided' END) THEN
   RAISE EXCEPTION 'experiment_exact_human_result_interpretation_required' USING ERRCODE='23514'; END IF;
 ELSE RAISE EXCEPTION 'experiment_transition_owner_unqualified' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION aw_experiment_analysis_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r business_experiments%ROWTYPE; v business_experiment_versions%ROWTYPE; c business_experiment_completions%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM business_experiment_versions WHERE company_id=OLD.company_id AND id=OLD.version_id)
   AND EXISTS(SELECT 1 FROM business_experiment_completions WHERE company_id=OLD.company_id AND version_id=OLD.version_id) THEN
   RAISE EXCEPTION 'experiment_analysis_immutable' USING ERRCODE='23514'; END IF; RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'experiment_analysis_immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO r FROM business_experiments WHERE company_id=NEW.company_id AND id=NEW.experiment_id;
 SELECT * INTO v FROM business_experiment_versions WHERE company_id=NEW.company_id AND experiment_id=NEW.experiment_id AND id=NEW.version_id;
 SELECT * INTO c FROM business_experiment_completions WHERE company_id=NEW.company_id AND experiment_id=NEW.experiment_id AND version_id=NEW.version_id;
 IF r.id IS NULL OR v.id IS NULL OR c.id IS NULL OR r.current_version_id<>NEW.version_id OR r.state<>'analyzing' OR r.updated_at<>NEW.analyzed_at
  OR c.reason='cancelled' OR NEW.definition_hash<>v.content_hash OR NEW.analyzed_at<c.completed_at OR NEW.analyzed_at>=v.expires_at
  OR NEW.capture_json->>'versionId' IS DISTINCT FROM NEW.version_id::text OR NEW.capture_json->>'definitionHash' IS DISTINCT FROM v.content_hash
  OR NEW.result_json->>'definitionHash' IS DISTINCT FROM v.content_hash OR NEW.result_json->>'status' NOT IN ('pass','fail','inconclusive','invalid')
  OR (NEW.capture_json->>'analyzedAt')::timestamptz IS DISTINCT FROM NEW.analyzed_at
  OR (NEW.capture_json->>'completedAt')::timestamptz IS DISTINCT FROM c.completed_at
  OR NEW.capture_json->>'completionReason' IS DISTINCT FROM c.reason
  OR jsonb_typeof(NEW.capture_json->'units') IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION 'experiment_exact_final_capture_required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_experiment_analysis_guard BEFORE INSERT OR UPDATE OR DELETE ON business_experiment_analyses FOR EACH ROW EXECUTE FUNCTION aw_experiment_analysis_guard();
--> statement-breakpoint
CREATE FUNCTION aw_experiment_outcome_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a business_experiment_analyses%ROWTYPE; u business_experiment_assignments%ROWTYPE; v business_experiment_versions%ROWTYPE; i issues%ROWTYPE; p projects%ROWTYPE; metric business_metric_versions%ROWTYPE; expected_value integer;
BEGIN
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM business_experiment_versions WHERE company_id=OLD.company_id AND id=OLD.version_id)
   AND EXISTS(SELECT 1 FROM business_experiment_analyses WHERE company_id=OLD.company_id AND id=OLD.analysis_id)
   AND EXISTS(SELECT 1 FROM business_experiment_assignments WHERE company_id=OLD.company_id AND id=OLD.assignment_id)
   AND EXISTS(SELECT 1 FROM business_metric_versions WHERE company_id=OLD.company_id AND id=OLD.metric_version_id)
   AND EXISTS(SELECT 1 FROM analytical_lineage_manifests WHERE company_id=OLD.company_id AND id=OLD.lineage_manifest_id) THEN
   RAISE EXCEPTION 'experiment_outcome_immutable' USING ERRCODE='23514'; END IF; RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'experiment_outcome_immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO a FROM business_experiment_analyses WHERE company_id=NEW.company_id AND experiment_id=NEW.experiment_id AND version_id=NEW.version_id AND id=NEW.analysis_id;
 SELECT * INTO u FROM business_experiment_assignments WHERE company_id=NEW.company_id AND experiment_id=NEW.experiment_id AND version_id=NEW.version_id AND id=NEW.assignment_id;
 SELECT * INTO v FROM business_experiment_versions WHERE company_id=NEW.company_id AND experiment_id=NEW.experiment_id AND id=NEW.version_id;
 SELECT * INTO metric FROM business_metric_versions WHERE company_id=NEW.company_id AND metric_id=NEW.metric_id AND id=NEW.metric_version_id;
 IF a.id IS NULL OR u.id IS NULL OR v.id IS NULL OR metric.id IS NULL OR NEW.captured_at<>a.analyzed_at OR a.capture_json->>'completionReason'<>'fixed_horizon'
  OR NOT EXISTS(SELECT 1 FROM business_experiments WHERE company_id=NEW.company_id AND id=NEW.experiment_id AND current_version_id=NEW.version_id AND state='analyzing')
  OR NOT EXISTS(SELECT 1 FROM business_experiment_metric_pins WHERE company_id=NEW.company_id AND version_id=NEW.version_id AND metric_key=NEW.metric_key AND metric_id=NEW.metric_id AND metric_version_id=NEW.metric_version_id)
  OR NEW.metric_key ~ '^invariant_[1-8]$' OR NEW.source_snapshot_json->>'id' IS DISTINCT FROM u.unit_id::text
  OR NEW.source_snapshot_json->>'entity' IS DISTINCT FROM u.unit_type
  OR NEW.source_snapshot_json->>'createdAt' IS DISTINCT FROM u.source_snapshot_json->>'createdAt' THEN
   RAISE EXCEPTION 'experiment_exact_native_outcome_required' USING ERRCODE='23514'; END IF;
 IF u.unit_type='issue' THEN
  SELECT * INTO i FROM issues WHERE company_id=NEW.company_id AND id=u.unit_id AND hidden_at IS NULL;
  IF i.id IS NULL OR NEW.source_snapshot_json->>'status' IS DISTINCT FROM i.status
   OR NEW.source_snapshot_json->>'projectId' IS DISTINCT FROM i.project_id::text
   OR (NEW.source_snapshot_json->>'updatedAt')::timestamptz IS DISTINCT FROM date_trunc('milliseconds',i.updated_at) THEN
   RAISE EXCEPTION 'experiment_actual_issue_capture_required' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO p FROM projects WHERE company_id=NEW.company_id AND id=u.unit_id AND archived_at IS NULL;
  IF p.id IS NULL OR NEW.source_snapshot_json->>'status' IS DISTINCT FROM p.status
   OR NEW.source_snapshot_json->>'projectId' IS NOT NULL
   OR (NEW.source_snapshot_json->>'updatedAt')::timestamptz IS DISTINCT FROM date_trunc('milliseconds',p.updated_at) THEN
   RAISE EXCEPTION 'experiment_actual_project_capture_required' USING ERRCODE='23514'; END IF;
 END IF;
 expected_value=CASE WHEN metric.definition_json->'calculation'->'numerator'->'statuses' ? (NEW.source_snapshot_json->>'status') THEN 1 ELSE 0 END;
 IF NEW.value<>expected_value OR NEW.captured_at<(v.definition_json->'sampleOrDurationPlan'->>'until')::timestamptz THEN
  RAISE EXCEPTION 'experiment_registered_binary_outcome_required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_experiment_outcome_guard BEFORE INSERT OR UPDATE OR DELETE ON business_experiment_outcomes FOR EACH ROW EXECUTE FUNCTION aw_experiment_outcome_guard();
--> statement-breakpoint
CREATE FUNCTION aw_experiment_outcome_erasure() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE manifest uuid;
BEGIN
 SELECT lineage_manifest_id INTO manifest FROM business_experiment_versions WHERE company_id=OLD.company_id AND id=OLD.version_id;
 IF manifest IS NOT NULL THEN DELETE FROM analytical_lineage_manifests WHERE company_id=OLD.company_id AND id=manifest; END IF;
 DELETE FROM analytical_lineage_manifests WHERE company_id=OLD.company_id AND id=OLD.lineage_manifest_id;
 RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_experiment_outcome_erasure AFTER DELETE ON business_experiment_outcomes FOR EACH ROW EXECUTE FUNCTION aw_experiment_outcome_erasure();
--> statement-breakpoint
CREATE FUNCTION aw_experiment_analysis_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected bigint; actual bigint; declared bigint;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM business_experiment_analyses WHERE id=NEW.id) THEN RETURN NEW; END IF;
 SELECT count(*) INTO declared FROM business_experiment_assignments WHERE company_id=NEW.company_id AND version_id=NEW.version_id;
 IF declared<>jsonb_array_length(NEW.capture_json->'units') OR EXISTS(SELECT 1 FROM business_experiment_assignments u WHERE u.company_id=NEW.company_id AND u.version_id=NEW.version_id AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.capture_json->'units') c WHERE c->>'unitId'=u.unit_id::text AND c->>'assignmentReceiptHash'=u.receipt_hash AND c->>'arm'=u.arm)) THEN
  RAISE EXCEPTION 'experiment_complete_assignment_capture_required' USING ERRCODE='23514'; END IF;
 IF NEW.capture_json->>'completionReason'='fixed_horizon' THEN
  SELECT declared*count(*) INTO expected FROM business_experiment_metric_pins WHERE company_id=NEW.company_id AND version_id=NEW.version_id AND metric_key !~ '^invariant_[1-8]$';
 ELSE expected=0; END IF;
 SELECT count(*) INTO actual FROM business_experiment_outcomes WHERE company_id=NEW.company_id AND analysis_id=NEW.id;
 IF actual<>expected OR NOT EXISTS(SELECT 1 FROM business_experiment_transitions WHERE company_id=NEW.company_id AND experiment_id=NEW.experiment_id AND version_id=NEW.version_id AND from_state='completed' AND to_state='analyzing' AND created_at=NEW.analyzed_at)
  OR EXISTS(SELECT 1 FROM business_experiment_outcomes o JOIN business_experiment_assignments u ON u.id=o.assignment_id AND u.company_id=o.company_id WHERE o.company_id=NEW.company_id AND o.analysis_id=NEW.id AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.capture_json->'units') cu, jsonb_array_elements(cu->'outcomes') co WHERE cu->>'unitId'=u.unit_id::text AND co->>'outcomeReceiptId'=o.id::text AND co->>'key'=o.metric_key AND co->>'metricId'=o.metric_id::text AND co->>'metricVersionId'=o.metric_version_id::text AND co->>'sourceHash'=o.source_hash AND (co->>'value')::integer=o.value)) THEN
  RAISE EXCEPTION 'experiment_complete_final_outcomes_required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER aw_experiment_analysis_complete AFTER INSERT ON business_experiment_analyses DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION aw_experiment_analysis_complete();
--> statement-breakpoint
CREATE FUNCTION aw_experiment_analysis_transition_complete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.to_state='analyzing' AND EXISTS(SELECT 1 FROM business_experiment_versions WHERE id=NEW.version_id AND company_id=NEW.company_id)
  AND NOT EXISTS(SELECT 1 FROM business_experiment_analyses WHERE company_id=NEW.company_id AND experiment_id=NEW.experiment_id AND version_id=NEW.version_id AND analyzed_at=NEW.created_at) THEN
  RAISE EXCEPTION 'experiment_analysis_transition_requires_result' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER aw_experiment_analysis_transition_complete AFTER INSERT ON business_experiment_transitions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION aw_experiment_analysis_transition_complete();
--> statement-breakpoint
CREATE FUNCTION aw_experiment_interpretation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a business_experiment_analyses%ROWTYPE; r business_experiments%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM business_experiment_analyses WHERE company_id=OLD.company_id AND id=OLD.analysis_id) THEN
   RAISE EXCEPTION 'experiment_interpretation_immutable' USING ERRCODE='23514'; END IF; RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'experiment_interpretation_immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO a FROM business_experiment_analyses WHERE company_id=NEW.company_id AND experiment_id=NEW.experiment_id AND version_id=NEW.version_id AND id=NEW.analysis_id;
 SELECT * INTO r FROM business_experiments WHERE company_id=NEW.company_id AND id=NEW.experiment_id;
 IF a.id IS NULL OR r.id IS NULL OR r.current_version_id<>NEW.version_id OR r.state<>'analyzing' OR NEW.interpreted_at<a.analyzed_at
  OR NEW.conclusion='ship_candidate' AND (a.result_json->>'status'<>'pass' OR a.result_json->'numericallyQualified'<>'true'::jsonb)
  OR a.result_json->>'status'='invalid' AND NEW.conclusion<>'abstain' THEN
  RAISE EXCEPTION 'experiment_exact_advisory_human_interpretation_required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_experiment_interpretation_guard BEFORE INSERT OR UPDATE OR DELETE ON business_experiment_interpretations FOR EACH ROW EXECUTE FUNCTION aw_experiment_interpretation_guard();
--> statement-breakpoint
CREATE FUNCTION aw_experiment_interpretation_complete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM business_experiment_interpretations WHERE id=NEW.id) AND NOT EXISTS(SELECT 1 FROM business_experiment_transitions WHERE company_id=NEW.company_id AND experiment_id=NEW.experiment_id AND version_id=NEW.version_id AND from_state='analyzing' AND to_state IN ('decided','inconclusive','invalid') AND created_at=NEW.interpreted_at AND rationale=NEW.rationale) THEN
  RAISE EXCEPTION 'experiment_interpretation_must_advance_owner' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER aw_experiment_interpretation_complete AFTER INSERT ON business_experiment_interpretations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION aw_experiment_interpretation_complete();
