ALTER TABLE "causal_analysis_runs" DROP CONSTRAINT "causal_analysis_runs_content_check";--> statement-breakpoint
ALTER TABLE "causal_analysis_runs" ADD CONSTRAINT "causal_analysis_runs_content_check" CHECK ((("causal_analysis_runs"."provider_key"='aw_native_registered_randomization' and "causal_analysis_runs"."provider_version"='1' and "causal_analysis_runs"."method_key"='registered_primary_itt') or ("causal_analysis_runs"."provider_key"='dowhy' and "causal_analysis_runs"."provider_version"='0.14' and "causal_analysis_runs"."method_key"='backdoor.linear_regression')) and "causal_analysis_runs"."analysis_plan_hash" ~ '^[0-9a-f]{64}$' and "causal_analysis_runs"."assumptions_snapshot_hash" ~ '^[0-9a-f]{64}$' and "causal_analysis_runs"."receipt_hash" ~ '^[0-9a-f]{64}$' and "causal_analysis_runs"."signature" ~ '^decision-spec-v1[.][0-9a-f]{64}$' and jsonb_typeof("causal_analysis_runs"."result_json")='object' and "causal_analysis_runs"."completed_at">="causal_analysis_runs"."started_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_causal_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
 IF NEW.definition_json ? 'providerProfile' THEN
  IF jsonb_typeof(NEW.definition_json->'providerProfile') IS DISTINCT FROM 'object'
   OR NEW.definition_json->'providerProfile'->>'provider' IS DISTINCT FROM 'dowhy'
   OR NEW.definition_json->'providerProfile'->>'version' IS DISTINCT FROM '0.14'
   OR NEW.definition_json->'providerProfile'->>'python' IS DISTINCT FROM '3.12.14'
   OR COALESCE(NEW.definition_json->'providerProfile'->>'bundleHash','') !~ '^[0-9a-f]{64}$'
   OR COALESCE(NEW.definition_json->'providerProfile'->>'conformanceHash','') !~ '^[0-9a-f]{64}$'
   OR NEW.definition_json->>'identificationStrategy' IS DISTINCT FROM 'registered_randomized_assignment'
   OR NEW.analysis_id IS NULL OR jsonb_array_length(NEW.definition_json->'graph'->'nodes')<>2
   OR jsonb_array_length(NEW.definition_json->'graph'->'edges')<>1 THEN
   RAISE EXCEPTION 'causal_fixed_dowhy_profile_required' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_causal_run_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v causal_claim_versions%ROWTYPE; r causal_claims%ROWTYPE; review causal_claim_reviews%ROWTYPE; d jsonb; item jsonb; i integer; expected text[]:=ARRAY['random_common_cause','placebo_treatment_refuter','data_subset_refuter'];
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
   OR (NEW.result_json->>'language' IS DISTINCT FROM 'conditional_assignment_effect_on_native_proxy' AND NOT (NEW.provider_key='dowhy' AND NEW.result_json->>'status'='inconclusive' AND NEW.result_json->>'language'='causal_reliance_withheld'))
   OR NOT EXISTS(SELECT 1 FROM business_experiment_analyses a,LATERAL jsonb_array_elements(a.result_json->'metrics') primary_result
     WHERE a.company_id=NEW.company_id AND a.id=v.analysis_id AND a.result_json->'numericallyQualified'='true'::jsonb
      AND primary_result->>'role'='primary' AND primary_result->'effect'=NEW.result_json->'estimate'->'effect'
      AND primary_result->'interval'=NEW.result_json->'estimate'->'interval'
      AND (NEW.result_json->>'status'<>'supported' OR a.result_json->>'status'='pass')) THEN
   RAISE EXCEPTION 'causal_native_registered_estimate_required' USING ERRCODE='23514'; END IF;
 END IF;
 IF v.definition_json ? 'providerProfile' THEN
  IF NEW.provider_key<>'dowhy' OR NEW.provider_version<>'0.14' OR NEW.method_key<>'backdoor.linear_regression' THEN RAISE EXCEPTION 'causal_exact_provider_required' USING ERRCODE='23514'; END IF;
  IF NEW.result_json->'estimate' IS DISTINCT FROM 'null'::jsonb THEN
   d=NEW.result_json->'providerAnalysis'->'diagnostics';
   IF NEW.result_json->'providerAnalysis'->'profile' IS DISTINCT FROM v.definition_json->'providerProfile'
    OR COALESCE(NEW.result_json->'providerAnalysis'->>'nativeResultHash','') !~ '^[0-9a-f]{64}$'
    OR d->>'provider' IS DISTINCT FROM 'dowhy' OR d->>'version' IS DISTINCT FROM '0.14' OR d->>'python' IS DISTINCT FROM '3.12.14'
    OR d->>'bundleHash' IS DISTINCT FROM v.definition_json->'providerProfile'->>'bundleHash'
    OR d->>'method' IS DISTINCT FROM 'backdoor.linear_regression'
    OR d->>'identification' IS DISTINCT FROM 'identified_under_registered_randomization'
    OR d->'adjustmentSet' IS DISTINCT FROM '[]'::jsonb OR d->>'representation' IS DISTINCT FROM 'anonymous_binary_sufficient_counts'
    OR d->>'simulations' IS DISTINCT FROM '16' OR d->>'seed' IS DISTINCT FROM '1729'
    OR d->>'sensitivity' IS DISTINCT FROM 'unknown' OR d->>'uncertainty' IS DISTINCT FROM 'native_registered_interval_required'
    OR jsonb_typeof(d->'effect') IS DISTINCT FROM 'number'
    OR abs((d->>'effect')::numeric-(NEW.result_json->'estimate'->>'effect')::numeric)>0.000000001
    OR jsonb_typeof(d->'refutations') IS DISTINCT FROM 'array' OR jsonb_array_length(d->'refutations')<>3 THEN
    RAISE EXCEPTION 'causal_exact_dowhy_diagnostics_required' USING ERRCODE='23514';
   END IF;
   FOR i IN 0..2 LOOP
    item=d->'refutations'->i;
    IF item->>'method' IS DISTINCT FROM expected[i+1] OR jsonb_typeof(item->'effect') IS DISTINCT FROM 'number'
     OR (item->>'effect')::numeric NOT BETWEEN -1.001 AND 1.001
     OR item->'pValue' IS NULL OR jsonb_typeof(item->'pValue') NOT IN ('number','null')
     OR (jsonb_typeof(item->'pValue')='number' AND (item->>'pValue')::numeric NOT BETWEEN 0 AND 1)
     OR item->>'status' IS DISTINCT FROM (CASE WHEN item->'pValue'='null'::jsonb THEN 'unknown' WHEN (item->>'pValue')::numeric<0.05 THEN 'failed' ELSE 'passed' END) THEN
     RAISE EXCEPTION 'causal_dowhy_refutation_contract_required' USING ERRCODE='23514';
    END IF;
   END LOOP;
   IF NEW.result_json->'robustness'->>'providerRefutations' IS DISTINCT FROM (CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(d->'refutations') x WHERE x->>'status'='failed') THEN 'failed' WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(d->'refutations') x WHERE x->>'status'='unknown') THEN 'unknown' ELSE 'passed' END)
    OR (NEW.result_json->>'status' IN ('supported','refuted') AND NEW.result_json->'robustness'->>'providerRefutations' IS DISTINCT FROM 'passed') THEN RAISE EXCEPTION 'causal_refutation_reliance_withheld' USING ERRCODE='23514'; END IF;
  ELSIF NEW.result_json ? 'providerAnalysis' THEN RAISE EXCEPTION 'causal_unidentified_provider_estimate_forbidden' USING ERRCODE='23514'; END IF;
 ELSIF NEW.provider_key<>'aw_native_registered_randomization' OR NEW.provider_version<>'1' OR NEW.method_key<>'registered_primary_itt' OR NEW.result_json ? 'providerAnalysis' THEN
  RAISE EXCEPTION 'causal_exact_native_provider_required' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
