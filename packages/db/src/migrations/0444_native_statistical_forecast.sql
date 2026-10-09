-- Extend the original forecast guards; existing native rows keep their exact contracts.
CREATE OR REPLACE FUNCTION aw_forecast_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM forecast_specs WHERE company_id=OLD.company_id AND id=OLD.spec_id)
   AND EXISTS(SELECT 1 FROM analytical_lineage_manifests WHERE company_id=OLD.company_id AND id=OLD.lineage_manifest_id) THEN
   RAISE EXCEPTION 'forecast_definition_immutable' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'forecast_definition_immutable' USING ERRCODE='23514'; END IF;
 IF coalesce(NEW.definition_json->>'provider','') NOT IN ('aw_native','statsforecast') OR NEW.definition_json->>'purpose' IS DISTINCT FROM 'management_intelligence'
  OR NOT EXISTS(SELECT 1 FROM forecast_specs WHERE company_id=NEW.company_id AND id=NEW.spec_id AND status<>'retired' AND revision=NEW.revision AND updated_at=NEW.created_at)
  OR NOT EXISTS(SELECT 1 FROM analytical_lineage_manifests WHERE company_id=NEW.company_id AND id=NEW.lineage_manifest_id AND analysis_type='forecast_specification'
    AND analysis_ref=NEW.id AND definition_hash=NEW.content_hash AND created_at=NEW.created_at AND expires_at=NEW.expires_at)
  OR NOT EXISTS(SELECT 1 FROM business_metric_versions v JOIN business_metrics m ON m.company_id=v.company_id AND m.id=v.metric_id
    WHERE v.company_id=NEW.company_id AND v.metric_id=(NEW.definition_json->>'metricId')::uuid AND v.id=(NEW.definition_json->>'metricVersionId')::uuid
    AND m.status='published' AND m.published_version_id=v.id AND v.created_at<=NEW.created_at)
  THEN RAISE EXCEPTION 'forecast_exact_native_definition_required' USING ERRCODE='23514'; END IF;
 IF NEW.definition_json->>'provider'='statsforecast' AND (
  coalesce(NEW.definition_json->'candidate'->>'kind','') NOT IN ('auto_ets','auto_arima')
  OR jsonb_typeof(NEW.definition_json->'providerProfile') IS DISTINCT FROM 'object'
  OR NEW.definition_json->'providerProfile'->>'provider' IS DISTINCT FROM 'statsforecast'
  OR NEW.definition_json->'providerProfile'->>'version' IS DISTINCT FROM '2.1.1'
  OR NEW.definition_json->'providerProfile'->>'python' IS DISTINCT FROM '3.12.14'
  OR coalesce(NEW.definition_json->'providerProfile'->>'bundleHash','') !~ '^[0-9a-f]{64}$'
  OR coalesce(NEW.definition_json->'providerProfile'->>'conformanceHash','') !~ '^[0-9a-f]{64}$'
  OR jsonb_typeof(NEW.definition_json->'candidate'->'seasonLength') IS DISTINCT FROM 'number'
  OR (NEW.definition_json->'candidate'->>'seasonLength')::integer NOT BETWEEN 1 AND 365) THEN
  RAISE EXCEPTION 'forecast_statistical_profile_required' USING ERRCODE='23514'; END IF;
 IF NEW.definition_json->>'provider'='aw_native' AND NEW.definition_json ? 'providerProfile' THEN
  RAISE EXCEPTION 'forecast_native_profile_mix_not_admitted' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_forecast_artifact_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v forecast_spec_versions%ROWTYPE; p jsonb; observed business_metric_observations%ROWTYPE; artifact_kind text;
BEGIN
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM forecast_spec_versions WHERE company_id=OLD.company_id AND id=OLD.version_id)
   AND EXISTS(SELECT 1 FROM analytical_lineage_manifests WHERE company_id=OLD.company_id AND id=OLD.lineage_manifest_id) THEN
   RAISE EXCEPTION 'forecast_artifact_immutable' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'forecast_artifact_immutable' USING ERRCODE='23514'; END IF;
 artifact_kind=CASE WHEN TG_TABLE_NAME='forecast_runs' THEN 'forecast_run' ELSE 'forecast_backtest' END;
 SELECT * INTO v FROM forecast_spec_versions WHERE company_id=NEW.company_id AND spec_id=NEW.spec_id AND id=NEW.version_id;
 IF v.id IS NULL OR v.content_hash IS DISTINCT FROM NEW.definition_hash OR v.created_at>NEW.created_at OR v.expires_at<NEW.expires_at
  OR NEW.result_json->>'definitionHash' IS DISTINCT FROM NEW.definition_hash OR NEW.result_json->>'inputHash' IS DISTINCT FROM NEW.input_hash
  OR NEW.result_json->>'engineVersion' IS DISTINCT FROM (CASE WHEN v.definition_json->>'provider'='statsforecast' THEN 'aw-statsforecast-business-forecast-v1' ELSE 'aw-native-business-forecast-v1' END)
  OR coalesce(NEW.result_json->>'status','') NOT IN ('qualified','not_qualified','data_not_ready')
  OR (v.definition_json->>'provider'='aw_native' AND (NEW.result_json->'uncertainty'->>'method' IS DISTINCT FROM 'unavailable' OR NEW.result_json->'uncertainty'->'coverageLevel' IS DISTINCT FROM 'null'::jsonb))
  OR (v.definition_json->>'provider'='statsforecast' AND NEW.result_json->'providerProvenance' IS DISTINCT FROM v.definition_json->'providerProfile')
  OR jsonb_array_length(NEW.series_json) NOT BETWEEN 4 AND 1000
  OR NOT EXISTS(SELECT 1 FROM analytical_lineage_manifests m WHERE m.company_id=NEW.company_id AND m.id=NEW.lineage_manifest_id
    AND m.analysis_type=artifact_kind AND m.analysis_ref=NEW.id AND m.definition_hash=NEW.definition_hash AND m.input_hash=NEW.input_hash
    AND m.engine_version='aw-native-business-forecast-owner-v1' AND m.created_at=NEW.created_at AND m.expires_at=NEW.expires_at
    AND m.parameters_json->>'artifactHash'=NEW.content_hash)
  THEN RAISE EXCEPTION 'forecast_exact_native_artifact_required' USING ERRCODE='23514'; END IF;
 FOR p IN SELECT value FROM jsonb_array_elements(NEW.series_json) LOOP
  SELECT * INTO observed FROM business_metric_observations WHERE company_id=NEW.company_id AND id=(p->>'observationId')::uuid;
  IF observed.id IS NULL OR observed.metric_id<>(v.definition_json->>'metricId')::uuid OR observed.version_id<>(v.definition_json->>'metricVersionId')::uuid
   OR p->>'metricId' IS DISTINCT FROM observed.metric_id::text OR p->>'metricVersionId' IS DISTINCT FROM observed.version_id::text
   OR p->'value' IS DISTINCT FROM observed.result_json->'value' OR p->>'status' IS DISTINCT FROM observed.result_json->>'status'
   OR p->>'unit' IS DISTINCT FROM (SELECT definition_json->>'unit' FROM business_metric_versions WHERE company_id=NEW.company_id AND id=observed.version_id)
   OR (p->>'from')::timestamptz IS DISTINCT FROM (observed.result_json->>'from')::timestamptz
   OR (p->>'until')::timestamptz IS DISTINCT FROM (observed.result_json->>'until')::timestamptz
   OR (p->>'asOf')::timestamptz IS DISTINCT FROM (observed.result_json->>'asOf')::timestamptz
   OR coalesce(p->>'sourceHash','') !~ '^[0-9a-f]{64}$'
   OR observed.observed_at>NEW.cutoff OR observed.expires_at<NEW.expires_at
   THEN RAISE EXCEPTION 'forecast_native_observation_pin_required' USING ERRCODE='23514'; END IF;
  IF NEW.result_json->>'status'='qualified' AND (p->>'status'<>'observed' OR p->'value'='null'::jsonb
    OR (p->>'asOf')::timestamptz<(p->>'until')::timestamptz
    OR (p->>'asOf')::timestamptz>(p->>'until')::timestamptz+make_interval(secs=>(v.definition_json->>'captureLatencySeconds')::integer)
    OR (p->>'until')::timestamptz>NEW.cutoff) THEN
   RAISE EXCEPTION 'forecast_qualified_history_chronology_required' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF NEW.result_json->>'status'='qualified' AND (jsonb_array_length(NEW.series_json)<(v.definition_json->>'minimumHistory')::integer
   OR jsonb_array_length(NEW.result_json->'points')<>(v.definition_json->>'horizon')::integer
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.result_json->'points') predicted WHERE (v.definition_json->>'provider'='aw_native' AND predicted->'interval' IS DISTINCT FROM 'null'::jsonb) OR (predicted->>'from')::timestamptz<NEW.cutoff
    OR (predicted->>'value')::numeric<0 OR ((SELECT definition_json->>'valueType' FROM business_metric_versions WHERE company_id=NEW.company_id AND id=(v.definition_json->>'metricVersionId')::uuid)='ratio' AND (predicted->>'value')::numeric>1))) THEN
  RAISE EXCEPTION 'forecast_qualified_prediction_policy_required' USING ERRCODE='23514'; END IF;
 IF v.definition_json->>'provider'='statsforecast' AND NEW.result_json->>'status'='qualified' AND (
  NEW.result_json->'uncertainty'->>'method' IS DISTINCT FROM 'statsforecast_model'
  OR NEW.result_json->'uncertainty'->'coverageLevel' IS DISTINCT FROM '0.95'::jsonb
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.result_json->'points') point WHERE
    jsonb_typeof(point->'interval') IS DISTINCT FROM 'object'
    OR point->'interval'->>'method' IS DISTINCT FROM 'statsforecast_model'
    OR point->'interval'->'level' IS DISTINCT FROM '0.95'::jsonb
    OR jsonb_typeof(point->'value') IS DISTINCT FROM 'number'
    OR jsonb_typeof(point->'interval'->'lower') IS DISTINCT FROM 'number'
    OR jsonb_typeof(point->'interval'->'upper') IS DISTINCT FROM 'number'
    OR jsonb_typeof(point->'interval'->'level80'->'lower') IS DISTINCT FROM 'number'
    OR jsonb_typeof(point->'interval'->'level80'->'upper') IS DISTINCT FROM 'number'
    OR (point->'interval'->>'lower')::numeric<0
    OR (point->'interval'->>'lower')::numeric>(point->'interval'->'level80'->>'lower')::numeric
    OR (point->'interval'->'level80'->>'lower')::numeric>(point->>'value')::numeric
    OR (point->>'value')::numeric>(point->'interval'->'level80'->>'upper')::numeric
    OR (point->'interval'->'level80'->>'upper')::numeric>(point->'interval'->>'upper')::numeric
    OR ((SELECT definition_json->>'valueType' FROM business_metric_versions WHERE company_id=NEW.company_id AND id=(v.definition_json->>'metricVersionId')::uuid)='ratio' AND (point->'interval'->>'upper')::numeric>1))) THEN
  RAISE EXCEPTION 'forecast_statistical_interval_policy_required' USING ERRCODE='23514'; END IF;
 IF artifact_kind='forecast_run'  AND NOT EXISTS(SELECT 1 FROM forecast_specs r JOIN forecast_publications pub ON pub.company_id=r.company_id AND pub.spec_id=r.id AND pub.version_id=r.published_version_id
   JOIN forecast_backtests b ON b.company_id=pub.company_id AND b.id=pub.backtest_id
   WHERE r.company_id=NEW.company_id AND r.id=NEW.spec_id AND r.status='published' AND r.published_version_id=NEW.version_id AND pub.published_at<=NEW.created_at
    AND b.expires_at>NEW.created_at AND b.result_json->>'status'='qualified') THEN
   RAISE EXCEPTION 'forecast_run_human_publication_required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
