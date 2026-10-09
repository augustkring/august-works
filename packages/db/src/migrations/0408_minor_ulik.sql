CREATE TABLE "causal_analysis_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"provider_key" text NOT NULL,
	"provider_version" text NOT NULL,
	"method_key" text NOT NULL,
	"analysis_plan_hash" text NOT NULL,
	"assumptions_snapshot_hash" text NOT NULL,
	"source_hash" text,
	"result_json" jsonb NOT NULL,
	"receipt_hash" text NOT NULL,
	"signature" text NOT NULL,
	"created_by" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "causal_analysis_runs_tenant_uq" UNIQUE("company_id","claim_id","id"),
	CONSTRAINT "causal_analysis_runs_version_uq" UNIQUE("company_id","claim_id","version_id"),
	CONSTRAINT "causal_analysis_runs_content_check" CHECK ("causal_analysis_runs"."provider_key"='aw_native_registered_randomization' and "causal_analysis_runs"."provider_version"='1' and "causal_analysis_runs"."method_key"='registered_primary_itt' and "causal_analysis_runs"."analysis_plan_hash" ~ '^[0-9a-f]{64}$' and "causal_analysis_runs"."assumptions_snapshot_hash" ~ '^[0-9a-f]{64}$' and "causal_analysis_runs"."receipt_hash" ~ '^[0-9a-f]{64}$' and "causal_analysis_runs"."signature" ~ '^decision-spec-v1[.][0-9a-f]{64}$' and jsonb_typeof("causal_analysis_runs"."result_json")='object' and "causal_analysis_runs"."completed_at">="causal_analysis_runs"."started_at")
);
--> statement-breakpoint
CREATE TABLE "causal_claim_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"definition_hash" text NOT NULL,
	"source_hash" text,
	"rationale" text NOT NULL,
	"receipt_hash" text NOT NULL,
	"signature" text NOT NULL,
	"reviewed_by" text NOT NULL,
	"reviewed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "causal_claim_reviews_version_uq" UNIQUE("company_id","claim_id","version_id"),
	CONSTRAINT "causal_claim_reviews_tenant_uq" UNIQUE("company_id","claim_id","version_id","id"),
	CONSTRAINT "causal_claim_reviews_content_check" CHECK ("causal_claim_reviews"."definition_hash" ~ '^[0-9a-f]{64}$' and "causal_claim_reviews"."receipt_hash" ~ '^[0-9a-f]{64}$' and "causal_claim_reviews"."signature" ~ '^decision-spec-v1[.][0-9a-f]{64}$' and length(btrim("causal_claim_reviews"."rationale")) between 10 and 2000)
);
--> statement-breakpoint
CREATE TABLE "causal_claim_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"definition_json" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"source_hash" text,
	"outcome_metric_id" uuid NOT NULL,
	"outcome_metric_version_id" uuid NOT NULL,
	"experiment_id" uuid,
	"experiment_version_id" uuid,
	"analysis_id" uuid,
	"interpretation_id" uuid,
	"lineage_manifest_id" uuid NOT NULL,
	"rationale" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "causal_claim_versions_tenant_uq" UNIQUE("company_id","claim_id","id"),
	CONSTRAINT "causal_claim_versions_revision_uq" UNIQUE("company_id","claim_id","revision"),
	CONSTRAINT "causal_claim_versions_content_check" CHECK ("causal_claim_versions"."revision">0 and "causal_claim_versions"."content_hash" ~ '^[0-9a-f]{64}$' and jsonb_typeof("causal_claim_versions"."definition_json")='object' and "causal_claim_versions"."expires_at">"causal_claim_versions"."created_at" and length(btrim("causal_claim_versions"."rationale")) between 10 and 2000),
	CONSTRAINT "causal_claim_versions_source_check" CHECK (("causal_claim_versions"."analysis_id" is null and "causal_claim_versions"."experiment_id" is null and "causal_claim_versions"."experiment_version_id" is null and "causal_claim_versions"."interpretation_id" is null and "causal_claim_versions"."source_hash" is null) or ("causal_claim_versions"."analysis_id" is not null and "causal_claim_versions"."experiment_id" is not null and "causal_claim_versions"."experiment_version_id" is not null and "causal_claim_versions"."interpretation_id" is not null and "causal_claim_versions"."source_hash" is not null and "causal_claim_versions"."source_hash" ~ '^[0-9a-f]{64}$'))
);
--> statement-breakpoint
CREATE TABLE "causal_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"claim_key" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'hypothesis' NOT NULL,
	"current_version_id" uuid,
	"reviewed_version_id" uuid,
	"latest_run_id" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "causal_claims_tenant_uq" UNIQUE("company_id","id"),
	CONSTRAINT "causal_claims_key_uq" UNIQUE("company_id","claim_key"),
	CONSTRAINT "causal_claims_state_check" CHECK ("causal_claims"."revision">0 and "causal_claims"."status" in ('hypothesis','association','supported','refuted','inconclusive','expired','revoked') and "causal_claims"."updated_at">="causal_claims"."created_at")
);
--> statement-breakpoint
ALTER TABLE "causal_analysis_runs" ADD CONSTRAINT "causal_analysis_runs_version_fk" FOREIGN KEY ("company_id","claim_id","version_id") REFERENCES "public"."causal_claim_versions"("company_id","claim_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "causal_analysis_runs" ADD CONSTRAINT "causal_analysis_runs_review_fk" FOREIGN KEY ("company_id","claim_id","version_id","review_id") REFERENCES "public"."causal_claim_reviews"("company_id","claim_id","version_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "causal_claim_reviews" ADD CONSTRAINT "causal_claim_reviews_version_fk" FOREIGN KEY ("company_id","claim_id","version_id") REFERENCES "public"."causal_claim_versions"("company_id","claim_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "causal_claim_versions" ADD CONSTRAINT "causal_claim_versions_root_fk" FOREIGN KEY ("company_id","claim_id") REFERENCES "public"."causal_claims"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "causal_claim_versions" ADD CONSTRAINT "causal_claim_versions_metric_fk" FOREIGN KEY ("company_id","outcome_metric_id","outcome_metric_version_id") REFERENCES "public"."business_metric_versions"("company_id","metric_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "causal_claim_versions" ADD CONSTRAINT "causal_claim_versions_analysis_fk" FOREIGN KEY ("company_id","experiment_id","experiment_version_id","analysis_id") REFERENCES "public"."business_experiment_analyses"("company_id","experiment_id","version_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "causal_claim_versions" ADD CONSTRAINT "causal_claim_versions_interpretation_fk" FOREIGN KEY ("company_id","experiment_id","experiment_version_id","analysis_id","interpretation_id") REFERENCES "public"."business_experiment_interpretations"("company_id","experiment_id","version_id","analysis_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "causal_claim_versions" ADD CONSTRAINT "causal_claim_versions_lineage_fk" FOREIGN KEY ("company_id","lineage_manifest_id") REFERENCES "public"."analytical_lineage_manifests"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "causal_claims" ADD CONSTRAINT "causal_claims_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "causal_claims" ADD CONSTRAINT "causal_claims_current_version_fk" FOREIGN KEY ("company_id","id","current_version_id") REFERENCES "public"."causal_claim_versions"("company_id","claim_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "causal_claims" ADD CONSTRAINT "causal_claims_reviewed_version_fk" FOREIGN KEY ("company_id","id","reviewed_version_id") REFERENCES "public"."causal_claim_versions"("company_id","claim_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "causal_claims" ADD CONSTRAINT "causal_claims_latest_run_fk" FOREIGN KEY ("company_id","id","latest_run_id") REFERENCES "public"."causal_analysis_runs"("company_id","claim_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "causal_analysis_runs_claim_time_idx" ON "causal_analysis_runs" USING btree ("company_id","claim_id","completed_at","id");--> statement-breakpoint
CREATE FUNCTION aw_causal_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r causal_claims%ROWTYPE; m analytical_lineage_manifests%ROWTYPE; ref jsonb;
BEGIN
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'causal_version_immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM causal_claims WHERE company_id=OLD.company_id AND id=OLD.claim_id)
   AND EXISTS(SELECT 1 FROM analytical_lineage_manifests WHERE company_id=OLD.company_id AND id=OLD.lineage_manifest_id)
   AND EXISTS(SELECT 1 FROM business_metric_versions WHERE company_id=OLD.company_id AND id=OLD.outcome_metric_version_id)
   AND (OLD.analysis_id IS NULL OR EXISTS(SELECT 1 FROM business_experiment_analyses WHERE company_id=OLD.company_id AND id=OLD.analysis_id))
   AND (OLD.interpretation_id IS NULL OR EXISTS(SELECT 1 FROM business_experiment_interpretations WHERE company_id=OLD.company_id AND id=OLD.interpretation_id))
   AND NOT aw_company_content_erasure_current(OLD.company_id) THEN RAISE EXCEPTION 'causal_version_immutable' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 END IF;
 SELECT * INTO r FROM causal_claims WHERE company_id=NEW.company_id AND id=NEW.claim_id;
 SELECT * INTO m FROM analytical_lineage_manifests WHERE company_id=NEW.company_id AND id=NEW.lineage_manifest_id;
 ref=NEW.definition_json->'experimentEvidence';
 IF r.id IS NULL OR r.status='revoked' OR NEW.revision NOT IN (r.revision,r.revision+1)
  OR (NEW.revision=r.revision AND (r.revision<>1 OR r.current_version_id IS NOT NULL OR NEW.created_at<>r.updated_at))
  OR NEW.created_at<r.updated_at OR NEW.definition_json->>'purpose' IS DISTINCT FROM 'management_intelligence'
  OR NEW.definition_json->>'interpretationBoundary' IS DISTINCT FROM 'conditional_native_proxy_advisory_only'
  OR NEW.definition_json->>'outcomeMetricId' IS DISTINCT FROM NEW.outcome_metric_id::text
  OR NEW.definition_json->>'outcomeMetricVersionId' IS DISTINCT FROM NEW.outcome_metric_version_id::text
  OR m.id IS NULL OR m.analysis_type<>'causal_claim_version' OR m.analysis_ref<>NEW.id OR m.definition_hash<>NEW.content_hash
  OR m.created_at<>NEW.created_at OR m.expires_at<>NEW.expires_at THEN RAISE EXCEPTION 'causal_current_native_version_required' USING ERRCODE='23514'; END IF;
 IF NEW.analysis_id IS NULL THEN
  IF ref IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'causal_exact_source_required' USING ERRCODE='23514'; END IF;
 ELSE
  IF ref->>'type' IS DISTINCT FROM 'experiment_analysis' OR ref->>'id' IS DISTINCT FROM NEW.analysis_id::text
   OR ref->>'experimentId' IS DISTINCT FROM NEW.experiment_id::text OR ref->>'versionId' IS DISTINCT FROM NEW.experiment_version_id::text
   OR ref->>'interpretationId' IS DISTINCT FROM NEW.interpretation_id::text
   OR NOT EXISTS(SELECT 1 FROM business_experiment_interpretations WHERE company_id=NEW.company_id AND id=NEW.interpretation_id AND interpreted_at<=NEW.created_at) THEN
   RAISE EXCEPTION 'causal_exact_source_required' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_causal_version_guard BEFORE INSERT OR UPDATE OR DELETE ON causal_claim_versions FOR EACH ROW EXECUTE FUNCTION aw_causal_version_guard();
--> statement-breakpoint
CREATE FUNCTION aw_causal_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v causal_claim_versions%ROWTYPE; r causal_claims%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'causal_review_immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM causal_claim_versions WHERE company_id=OLD.company_id AND id=OLD.version_id) AND NOT aw_company_content_erasure_current(OLD.company_id) THEN RAISE EXCEPTION 'causal_review_immutable' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 END IF;
 SELECT * INTO v FROM causal_claim_versions WHERE company_id=NEW.company_id AND claim_id=NEW.claim_id AND id=NEW.version_id;
 SELECT * INTO r FROM causal_claims WHERE company_id=NEW.company_id AND id=NEW.claim_id;
 IF v.id IS NULL OR r.current_version_id IS DISTINCT FROM v.id OR r.status<>'hypothesis' OR r.reviewed_version_id IS NOT NULL
  OR v.content_hash<>NEW.definition_hash OR v.source_hash IS DISTINCT FROM NEW.source_hash OR NEW.reviewed_at<v.created_at OR NEW.reviewed_at>=v.expires_at THEN
  RAISE EXCEPTION 'causal_exact_current_human_review_required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_causal_review_guard BEFORE INSERT OR UPDATE OR DELETE ON causal_claim_reviews FOR EACH ROW EXECUTE FUNCTION aw_causal_review_guard();
--> statement-breakpoint
CREATE FUNCTION aw_causal_run_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v causal_claim_versions%ROWTYPE; r causal_claims%ROWTYPE; review causal_claim_reviews%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'causal_run_immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM causal_claim_versions WHERE company_id=OLD.company_id AND id=OLD.version_id) AND NOT aw_company_content_erasure_current(OLD.company_id) THEN RAISE EXCEPTION 'causal_run_immutable' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 END IF;
 SELECT * INTO v FROM causal_claim_versions WHERE company_id=NEW.company_id AND claim_id=NEW.claim_id AND id=NEW.version_id;
 SELECT * INTO r FROM causal_claims WHERE company_id=NEW.company_id AND id=NEW.claim_id;
 SELECT * INTO review FROM causal_claim_reviews WHERE company_id=NEW.company_id AND claim_id=NEW.claim_id AND version_id=NEW.version_id AND id=NEW.review_id;
 IF v.id IS NULL OR review.id IS NULL OR r.current_version_id IS DISTINCT FROM v.id OR r.reviewed_version_id IS DISTINCT FROM v.id
  OR r.status<>'hypothesis' OR r.latest_run_id IS NOT NULL OR NEW.source_hash IS DISTINCT FROM v.source_hash
  OR NEW.started_at<review.reviewed_at OR NEW.completed_at>=v.expires_at OR NEW.result_json->>'definitionHash' IS DISTINCT FROM v.content_hash
  OR NEW.result_json->>'engineVersion' IS DISTINCT FROM 'aw-native-causal-registered-primary-v1'
  OR NEW.result_json->>'executionAuthority' IS DISTINCT FROM 'advisory_only' OR NEW.result_json->>'status' IS NULL OR NEW.result_json->>'status' NOT IN ('supported','refuted','inconclusive') THEN
  RAISE EXCEPTION 'causal_exact_reviewed_run_required' USING ERRCODE='23514'; END IF;
 IF NEW.result_json->>'status' IN ('supported','refuted') OR NEW.result_json->'estimate' IS DISTINCT FROM 'null'::jsonb THEN
  IF v.analysis_id IS NULL OR NEW.result_json->'identification'->>'status' IS DISTINCT FROM 'conditional_identified'
   OR NEW.result_json->>'language' IS DISTINCT FROM 'conditional_assignment_effect_on_native_proxy'
   OR NOT EXISTS(SELECT 1 FROM business_experiment_analyses a,LATERAL jsonb_array_elements(a.result_json->'metrics') primary_result
     WHERE a.company_id=NEW.company_id AND a.id=v.analysis_id AND a.result_json->'numericallyQualified'='true'::jsonb
      AND primary_result->>'role'='primary' AND primary_result->'effect'=NEW.result_json->'estimate'->'effect'
      AND primary_result->'interval'=NEW.result_json->'estimate'->'interval'
      AND (NEW.result_json->>'status'<>'supported' OR a.result_json->>'status'='pass')) THEN
   RAISE EXCEPTION 'causal_native_registered_estimate_required' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_causal_run_guard BEFORE INSERT OR UPDATE OR DELETE ON causal_analysis_runs FOR EACH ROW EXECUTE FUNCTION aw_causal_run_guard();
--> statement-breakpoint
CREATE FUNCTION aw_causal_root_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v causal_claim_versions%ROWTYPE; run causal_analysis_runs%ROWTYPE;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.revision<>1 OR NEW.status<>'hypothesis' OR NEW.current_version_id IS NOT NULL OR NEW.reviewed_version_id IS NOT NULL OR NEW.latest_run_id IS NOT NULL THEN
   RAISE EXCEPTION 'causal_empty_root_required' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF (NEW.id,NEW.company_id,NEW.claim_key,NEW.created_by,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.company_id,OLD.claim_key,OLD.created_by,OLD.created_at)
  OR OLD.status='revoked' OR NEW.updated_at<OLD.updated_at THEN RAISE EXCEPTION 'causal_root_identity_immutable' USING ERRCODE='23514'; END IF;
 IF OLD.current_version_id IS NULL AND OLD.revision=1 AND NEW.revision=1 THEN
  IF NEW.current_version_id IS NULL OR NEW.status<>'hypothesis' OR NEW.reviewed_version_id IS NOT NULL OR NEW.latest_run_id IS NOT NULL THEN RAISE EXCEPTION 'causal_initial_version_required' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'causal_revision_cas_required' USING ERRCODE='23514'; END IF;
 SELECT * INTO v FROM causal_claim_versions WHERE company_id=NEW.company_id AND claim_id=NEW.id AND id=NEW.current_version_id;
 IF v.id IS NULL THEN RAISE EXCEPTION 'causal_current_version_required' USING ERRCODE='23514'; END IF;
 IF NEW.current_version_id IS DISTINCT FROM OLD.current_version_id THEN
  IF v.revision<>NEW.revision OR v.created_at<>NEW.updated_at OR NEW.status<>'hypothesis' OR NEW.reviewed_version_id IS NOT NULL OR NEW.latest_run_id IS NOT NULL THEN RAISE EXCEPTION 'causal_amendment_resets_review_required' USING ERRCODE='23514'; END IF;
 ELSIF NEW.latest_run_id IS DISTINCT FROM OLD.latest_run_id THEN
  SELECT * INTO run FROM causal_analysis_runs WHERE company_id=NEW.company_id AND claim_id=NEW.id AND id=NEW.latest_run_id;
  IF run.id IS NULL OR run.version_id<>v.id OR NEW.status IS DISTINCT FROM run.result_json->>'status' OR NEW.reviewed_version_id IS DISTINCT FROM v.id OR NEW.updated_at<run.completed_at THEN RAISE EXCEPTION 'causal_exact_result_transition_required' USING ERRCODE='23514'; END IF;
 ELSIF NEW.reviewed_version_id IS DISTINCT FROM OLD.reviewed_version_id THEN
  IF NEW.reviewed_version_id IS DISTINCT FROM v.id OR OLD.reviewed_version_id IS NOT NULL OR NEW.status<>'hypothesis' OR NEW.latest_run_id IS NOT NULL
   OR NOT EXISTS(SELECT 1 FROM causal_claim_reviews WHERE company_id=NEW.company_id AND claim_id=NEW.id AND version_id=v.id AND reviewed_at<=NEW.updated_at) THEN RAISE EXCEPTION 'causal_human_review_receipt_required' USING ERRCODE='23514'; END IF;
 ELSIF NEW.status<>'revoked' OR OLD.status='revoked' THEN RAISE EXCEPTION 'causal_explicit_transition_required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_causal_root_guard BEFORE INSERT OR UPDATE ON causal_claims FOR EACH ROW EXECUTE FUNCTION aw_causal_root_guard();
--> statement-breakpoint
CREATE FUNCTION aw_causal_material_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r causal_claims%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='causal_claims' THEN
  SELECT * INTO r FROM causal_claims WHERE company_id=NEW.company_id AND id=NEW.id;
  IF r.id IS NOT NULL AND r.current_version_id IS NULL THEN RAISE EXCEPTION 'causal_initial_material_incomplete' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO r FROM causal_claims WHERE company_id=NEW.company_id AND id=NEW.claim_id;
  IF r.id IS NULL THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='causal_claim_versions' THEN
   IF r.current_version_id IS DISTINCT FROM NEW.id THEN RAISE EXCEPTION 'causal_material_transition_incomplete' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME='causal_claim_reviews' THEN
   IF r.reviewed_version_id IS DISTINCT FROM NEW.version_id THEN RAISE EXCEPTION 'causal_material_transition_incomplete' USING ERRCODE='23514'; END IF;
  ELSE
   IF r.latest_run_id IS DISTINCT FROM NEW.id OR r.status IS DISTINCT FROM NEW.result_json->>'status' THEN RAISE EXCEPTION 'causal_material_transition_incomplete' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER aw_causal_initial_material_complete AFTER INSERT ON causal_claims DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION aw_causal_material_complete();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER aw_causal_version_material_complete AFTER INSERT ON causal_claim_versions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION aw_causal_material_complete();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER aw_causal_review_material_complete AFTER INSERT ON causal_claim_reviews DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION aw_causal_material_complete();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER aw_causal_run_material_complete AFTER INSERT ON causal_analysis_runs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION aw_causal_material_complete();
--> statement-breakpoint
CREATE FUNCTION aw_causal_erased_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 DELETE FROM analytical_lineage_manifests WHERE company_id=OLD.company_id AND id=OLD.lineage_manifest_id;
 DELETE FROM causal_claims r WHERE r.company_id=OLD.company_id AND r.id=OLD.claim_id AND NOT EXISTS(SELECT 1 FROM causal_claim_versions WHERE company_id=r.company_id AND claim_id=r.id);
 RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_causal_erased_version AFTER DELETE ON causal_claim_versions FOR EACH ROW EXECUTE FUNCTION aw_causal_erased_version();
