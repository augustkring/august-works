CREATE TABLE "business_scenario_calculation_pins" (
	"company_id" uuid NOT NULL,
	"scenario_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"artifact_version_id" uuid NOT NULL,
	"artifact_hash" text NOT NULL,
	CONSTRAINT "business_scenario_calculation_pins_version_uq" UNIQUE("company_id","scenario_id","version_id"),
	CONSTRAINT "business_scenario_calculation_pins_hash_check" CHECK ("business_scenario_calculation_pins"."artifact_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "business_scenario_calculation_pins" ADD CONSTRAINT "business_scenario_calculation_pins_version_fk" FOREIGN KEY ("company_id","scenario_id","version_id") REFERENCES "public"."business_scenario_versions"("company_id","scenario_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_scenario_calculation_pins" ADD CONSTRAINT "business_scenario_calculation_pins_artifact_fk" FOREIGN KEY ("company_id","artifact_version_id") REFERENCES "public"."automation_artifact_versions"("company_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_scenario_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pin jsonb; declaration jsonb; observation business_metric_observations%ROWTYPE; forecast forecast_runs%ROWTYPE; metric_definition jsonb; expected_unit jsonb;
BEGIN
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM business_scenarios WHERE company_id=OLD.company_id AND id=OLD.scenario_id)
   AND EXISTS(SELECT 1 FROM analytical_lineage_manifests WHERE company_id=OLD.company_id AND id=OLD.lineage_manifest_id)
   AND NOT (OLD.definition_json->>'calculationType'='validated_automation_artifact' AND NOT EXISTS(SELECT 1 FROM automation_artifact_versions WHERE company_id=OLD.company_id AND id=(OLD.definition_json->'calculationRef'->>'versionId')::uuid))
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(OLD.inputs_json) item WHERE
    item->>'kind'='metric_observation' AND NOT EXISTS(SELECT 1 FROM business_metric_observations WHERE company_id=OLD.company_id AND id=(item->>'sourceId')::uuid)
    OR item->>'kind'='forecast_point' AND NOT EXISTS(SELECT 1 FROM forecast_runs WHERE company_id=OLD.company_id AND id=(item->>'sourceId')::uuid)) THEN
    RAISE EXCEPTION 'scenario_version_immutable' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'scenario_version_immutable' USING ERRCODE='23514'; END IF;
 IF NEW.definition_json->>'purpose' IS DISTINCT FROM 'management_intelligence'
  OR coalesce(NEW.definition_json->>'calculationType','') NOT IN ('formula','forecast_composition','bounded_monte_carlo','validated_automation_artifact')
  OR jsonb_array_length(NEW.inputs_json)>32 OR jsonb_array_length(NEW.inputs_json)<>jsonb_array_length(NEW.definition_json->'inputs')
  OR NOT EXISTS(SELECT 1 FROM business_scenarios WHERE company_id=NEW.company_id AND id=NEW.scenario_id AND status<>'retired' AND revision=NEW.revision AND updated_at=NEW.created_at)
  OR NOT EXISTS(SELECT 1 FROM analytical_lineage_manifests WHERE company_id=NEW.company_id AND id=NEW.lineage_manifest_id AND analysis_type='scenario_version'
   AND engine_version='aw-native-business-scenario-owner-v1' AND analysis_ref=NEW.id AND definition_hash=NEW.content_hash AND input_hash=NEW.input_hash AND created_at=NEW.created_at AND expires_at=NEW.expires_at)
  THEN RAISE EXCEPTION 'scenario_exact_native_version_required' USING ERRCODE='23514'; END IF;
 IF NEW.definition_json->>'calculationType'='validated_automation_artifact' THEN
  IF jsonb_array_length(NEW.definition_json->'formula')<>0 OR NOT EXISTS(
   SELECT 1 FROM automation_artifacts a JOIN automation_artifact_versions av ON av.company_id=a.company_id AND av.artifact_id=a.id
   WHERE a.company_id=NEW.company_id AND a.id=(NEW.definition_json->'calculationRef'->>'artifactId')::uuid
    AND av.id=(NEW.definition_json->'calculationRef'->>'versionId')::uuid AND av.content_hash=NEW.definition_json->'calculationRef'->>'contentHash'
    AND a.latest_version_id=av.id AND a.status='active' AND a.archived_at IS NULL AND a.created_by_optimizer_suggestion_id IS NULL
    AND a.side_effect_class='pure' AND a.risk_class IN ('C0','C1') AND a.kind IN ('expression','transform','typescript')
    AND av.created_at<=NEW.created_at AND av.validation_report->>'schema'='automation_artifact_gate.v1' AND av.validation_report->>'kind'='validation'
    AND av.validation_report->>'status'='passed' AND av.validation_report->>'contentHash'=av.content_hash
    AND av.security_report->>'schema'='automation_artifact_gate.v1' AND av.security_report->>'kind'='security'
    AND av.security_report->>'status'='passed' AND av.security_report->>'contentHash'=av.content_hash) THEN
   RAISE EXCEPTION 'scenario_exact_validated_artifact_required' USING ERRCODE='23514'; END IF;
 ELSIF NEW.definition_json ? 'calculationRef' THEN RAISE EXCEPTION 'scenario_unexpected_artifact_binding' USING ERRCODE='23514'; END IF;
 FOR pin IN SELECT value FROM jsonb_array_elements(NEW.inputs_json) LOOP
  SELECT value INTO declaration FROM jsonb_array_elements(NEW.definition_json->'inputs') WHERE value->>'key'=pin->>'key';
  IF declaration IS NULL OR pin->>'kind' IS DISTINCT FROM declaration->>'kind' OR coalesce(pin->>'contentHash','') !~ '^[0-9a-f]{64}$' OR jsonb_typeof(pin->'value') IS DISTINCT FROM 'number' THEN
   RAISE EXCEPTION 'scenario_native_input_declaration_required' USING ERRCODE='23514'; END IF;
  IF pin->>'kind'='metric_observation' THEN
   SELECT * INTO observation FROM business_metric_observations WHERE company_id=NEW.company_id AND id=(declaration->>'observationId')::uuid;
   SELECT definition_json INTO metric_definition FROM business_metric_versions WHERE company_id=NEW.company_id AND id=observation.version_id;
   IF observation.id IS NULL OR observation.metric_id::text IS DISTINCT FROM declaration->>'metricId' OR observation.version_id::text IS DISTINCT FROM declaration->>'metricVersionId'
    OR pin->>'sourceId' IS DISTINCT FROM observation.id::text OR pin->>'versionId' IS DISTINCT FROM observation.version_id::text OR pin->'pointIndex' IS DISTINCT FROM 'null'::jsonb
    OR pin->'value' IS DISTINCT FROM observation.result_json->'value' OR observation.result_json->>'status' IS DISTINCT FROM 'observed'
    OR observation.observed_at>NEW.created_at OR observation.expires_at<NEW.expires_at
    OR NOT EXISTS(SELECT 1 FROM business_metrics WHERE company_id=NEW.company_id AND id=observation.metric_id AND status='published' AND published_version_id=observation.version_id) THEN
    RAISE EXCEPTION 'scenario_exact_native_measurement_required' USING ERRCODE='23514'; END IF;
  ELSIF pin->>'kind'='forecast_point' THEN
   SELECT * INTO forecast FROM forecast_runs WHERE company_id=NEW.company_id AND id=(declaration->>'runId')::uuid;
   SELECT m.definition_json INTO metric_definition FROM business_metric_versions m JOIN forecast_spec_versions v
    ON v.company_id=m.company_id AND m.id=(v.definition_json->>'metricVersionId')::uuid WHERE v.company_id=NEW.company_id AND v.id=forecast.version_id;
   IF forecast.id IS NULL OR forecast.spec_id::text IS DISTINCT FROM declaration->>'specId' OR forecast.version_id::text IS DISTINCT FROM declaration->>'versionId'
    OR pin->>'sourceId' IS DISTINCT FROM forecast.id::text OR pin->>'versionId' IS DISTINCT FROM forecast.version_id::text OR pin->'pointIndex' IS DISTINCT FROM declaration->'pointIndex'
    OR forecast.result_json->>'status' IS DISTINCT FROM 'qualified' OR pin->'value' IS DISTINCT FROM forecast.result_json->'points'->((declaration->>'pointIndex')::integer)->'value'
    OR forecast.created_at>NEW.created_at OR forecast.expires_at<NEW.expires_at
    OR NOT EXISTS(SELECT 1 FROM forecast_specs WHERE company_id=NEW.company_id AND id=forecast.spec_id AND status='published' AND published_version_id=forecast.version_id) THEN
    RAISE EXCEPTION 'scenario_exact_native_forecast_required' USING ERRCODE='23514'; END IF;
  ELSE RAISE EXCEPTION 'scenario_unsupported_source' USING ERRCODE='23514'; END IF;
  IF metric_definition->>'authorityMode' IS DISTINCT FROM 'aw_native' OR coalesce(metric_definition->'calculation'->>'kind','') NOT IN ('native_count','native_ratio') THEN
   RAISE EXCEPTION 'scenario_qualified_native_metric_required' USING ERRCODE='23514'; END IF;
  expected_unit=CASE WHEN metric_definition->'calculation'->>'kind'='native_count' THEN jsonb_build_object(metric_definition->>'grain',1) ELSE '{}'::jsonb END;
  IF pin->'unit' IS DISTINCT FROM expected_unit OR declaration->'unit' IS DISTINCT FROM expected_unit THEN
   RAISE EXCEPTION 'scenario_exact_source_unit_required' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION aw_scenario_calculation_pin_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM business_scenario_versions WHERE company_id=OLD.company_id AND id=OLD.version_id)
   AND EXISTS(SELECT 1 FROM automation_artifact_versions WHERE company_id=OLD.company_id AND id=OLD.artifact_version_id) THEN
   RAISE EXCEPTION 'scenario_calculation_pin_immutable' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' OR NOT EXISTS(SELECT 1 FROM business_scenario_versions v JOIN automation_artifact_versions av ON av.company_id=v.company_id
  WHERE v.company_id=NEW.company_id AND v.scenario_id=NEW.scenario_id AND v.id=NEW.version_id AND v.definition_json->>'calculationType'='validated_automation_artifact'
   AND av.id=NEW.artifact_version_id AND av.id::text=v.definition_json->'calculationRef'->>'versionId'
   AND av.artifact_id::text=v.definition_json->'calculationRef'->>'artifactId' AND av.content_hash=NEW.artifact_hash AND av.content_hash=v.definition_json->'calculationRef'->>'contentHash') THEN
  RAISE EXCEPTION 'scenario_exact_calculation_pin_required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_scenario_calculation_pin_guard BEFORE INSERT OR UPDATE OR DELETE ON business_scenario_calculation_pins FOR EACH ROW EXECUTE FUNCTION aw_scenario_calculation_pin_guard();
--> statement-breakpoint
CREATE TRIGGER aw_scenario_erased_calculation_pin AFTER DELETE ON business_scenario_calculation_pins FOR EACH ROW EXECUTE FUNCTION aw_scenario_erased_source_pin();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_scenario_version_pins_required() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v business_scenario_versions%ROWTYPE;
BEGIN
 SELECT * INTO v FROM business_scenario_versions WHERE company_id=NEW.company_id AND id=NEW.id;
 IF v.id IS NOT NULL AND ((SELECT count(*) FROM business_scenario_source_pins WHERE company_id=v.company_id AND version_id=v.id)<>jsonb_array_length(v.definition_json->'inputs')
  OR (SELECT count(*) FROM business_scenario_calculation_pins WHERE company_id=v.company_id AND version_id=v.id)<>CASE WHEN v.definition_json->>'calculationType'='validated_automation_artifact' THEN 1 ELSE 0 END) THEN
  RAISE EXCEPTION 'scenario_complete_source_pins_required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION aw_scenario_calculation_run_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v business_scenario_versions%ROWTYPE;
BEGIN
 SELECT * INTO v FROM business_scenario_versions WHERE company_id=NEW.company_id AND scenario_id=NEW.scenario_id AND id=NEW.version_id;
 IF v.definition_json->>'calculationType'='validated_automation_artifact' THEN
  IF NEW.result_json->>'status'<>'data_not_ready' AND (NEW.result_json->'calculationArtifact'->>'runtime' IS DISTINCT FROM 'aw-native-automation-artifact-v1'
   OR NEW.result_json->'calculationArtifact'->>'artifactId' IS DISTINCT FROM v.definition_json->'calculationRef'->>'artifactId'
   OR NEW.result_json->'calculationArtifact'->>'versionId' IS DISTINCT FROM v.definition_json->'calculationRef'->>'versionId'
   OR NEW.result_json->'calculationArtifact'->>'contentHash' IS DISTINCT FROM v.definition_json->'calculationRef'->>'contentHash') THEN
   RAISE EXCEPTION 'scenario_exact_calculation_result_required' USING ERRCODE='23514'; END IF;
 ELSIF NEW.result_json ? 'calculationArtifact' THEN RAISE EXCEPTION 'scenario_unexpected_calculation_result' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_scenario_calculation_run_guard BEFORE INSERT ON business_scenario_runs FOR EACH ROW EXECUTE FUNCTION aw_scenario_calculation_run_guard();

--> statement-breakpoint
CREATE OR REPLACE FUNCTION "aw_guard_automation_artifact_version_delete"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- The existing company purge retains its company tombstone. Its immutable
  -- erasure proof must name this exact transaction; ordinary archival cannot
  -- authorize history deletion through the general FK planner.
  IF EXISTS(SELECT 1 FROM companies WHERE id=OLD.company_id AND status='archived'
   AND pause_reason='company_deleted' AND content_erasure_transaction_id=pg_current_xact_id()::text) THEN RETURN OLD; END IF;
  -- Company deletion can reach this row through either the direct company FK
  -- or the artifact cascade. Allow that lifecycle-owned cascade independent of
  -- PostgreSQL's internal RI trigger ordering.
  PERFORM 1
  FROM "companies"
  WHERE "id" = OLD."company_id";

  IF NOT FOUND THEN
    RETURN OLD;
  END IF;

  PERFORM 1
  FROM "automation_artifacts"
  WHERE "id" = OLD."artifact_id"
    AND "company_id" = OLD."company_id";

  -- History follows an explicit artifact/company cascade only after its owner
  -- has disappeared. Direct version deletion is never a supported mutation.
  IF NOT FOUND THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'automation artifact version history cannot be deleted directly'
    USING ERRCODE = '23514';
END;
$$;
