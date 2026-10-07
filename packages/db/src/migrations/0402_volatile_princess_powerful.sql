CREATE TABLE "decision_calculation_pins" (
	"company_id" uuid NOT NULL,
	"decision_id" uuid NOT NULL,
	"context_version_id" uuid NOT NULL,
	"material_key" text NOT NULL,
	"forecast_run_id" uuid,
	"scenario_run_id" uuid,
	"source_hash" text NOT NULL,
	CONSTRAINT "decision_calculation_pins_key_uq" UNIQUE("company_id","context_version_id","material_key"),
	CONSTRAINT "decision_calculation_pins_type_check" CHECK (("decision_calculation_pins"."forecast_run_id" is null) <> ("decision_calculation_pins"."scenario_run_id" is null) and "decision_calculation_pins"."source_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "decision_calculation_pins" ADD CONSTRAINT "decision_calculation_pins_version_fk" FOREIGN KEY ("company_id","decision_id","context_version_id") REFERENCES "public"."decision_context_versions"("company_id","decision_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_calculation_pins" ADD CONSTRAINT "decision_calculation_pins_forecast_fk" FOREIGN KEY ("company_id","forecast_run_id") REFERENCES "public"."forecast_runs"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_calculation_pins" ADD CONSTRAINT "decision_calculation_pins_scenario_fk" FOREIGN KEY ("company_id","scenario_run_id") REFERENCES "public"."business_scenario_runs"("company_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_decision_context_material_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v decision_context_versions%ROWTYPE;
BEGIN
 SELECT * INTO v FROM decision_context_versions WHERE company_id=NEW.company_id AND decision_id=NEW.decision_id AND id=NEW.id;
 IF NOT FOUND THEN RETURN NEW; END IF;
 IF (SELECT count(*) FROM decision_evidence_links WHERE company_id=v.company_id AND context_version_id=v.id)<>jsonb_array_length(v.definition_json->'evidence')
  OR (SELECT count(*) FROM decision_assumptions WHERE company_id=v.company_id AND context_version_id=v.id)<>jsonb_array_length(v.definition_json->'assumptions')
  OR (SELECT count(*) FROM decision_criteria WHERE company_id=v.company_id AND context_version_id=v.id)<>jsonb_array_length(v.definition_json->'criteria')
  OR (SELECT count(*) FROM decision_expected_outcomes WHERE company_id=v.company_id AND context_version_id=v.id)<>jsonb_array_length(v.definition_json->'expectedOutcomes')
  OR (SELECT count(*) FROM decision_calculation_pins WHERE company_id=v.company_id AND context_version_id=v.id)<>(SELECT count(*) FROM jsonb_array_elements(v.definition_json->'evidence') e WHERE e->'source'->>'type' IN ('forecast_run','scenario_run'))
  THEN RAISE EXCEPTION 'decision_context_material_incomplete' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION aw_decision_calculation_pin_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v decision_context_versions%ROWTYPE; ref jsonb; captured jsonb;
BEGIN
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM decision_context_versions WHERE company_id=OLD.company_id AND id=OLD.context_version_id)
   AND (OLD.forecast_run_id IS NULL OR EXISTS(SELECT 1 FROM forecast_runs WHERE company_id=OLD.company_id AND id=OLD.forecast_run_id))
   AND (OLD.scenario_run_id IS NULL OR EXISTS(SELECT 1 FROM business_scenario_runs WHERE company_id=OLD.company_id AND id=OLD.scenario_run_id)) THEN
   RAISE EXCEPTION 'decision_calculation_pin_immutable' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'decision_calculation_pin_immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO v FROM decision_context_versions WHERE company_id=NEW.company_id AND decision_id=NEW.decision_id AND id=NEW.context_version_id;
 SELECT value->'source' INTO ref FROM jsonb_array_elements(v.definition_json->'evidence') WHERE value->>'key'=NEW.material_key;
 SELECT value INTO captured FROM jsonb_array_elements(v.captured_evidence_json) WHERE value->>'key'=NEW.material_key;
 IF ref IS NULL OR captured->'source' IS DISTINCT FROM ref OR captured->>'sourceHash' IS DISTINCT FROM NEW.source_hash THEN
  RAISE EXCEPTION 'decision_exact_calculation_pin_required' USING ERRCODE='23514'; END IF;
 IF ref->>'type'='forecast_run' THEN
  IF NEW.scenario_run_id IS NOT NULL OR NEW.forecast_run_id::text IS DISTINCT FROM ref->>'id' OR NOT EXISTS(
   SELECT 1 FROM forecast_runs r JOIN forecast_specs s ON s.company_id=r.company_id AND s.id=r.spec_id
   WHERE r.company_id=NEW.company_id AND r.id=NEW.forecast_run_id AND r.spec_id::text=ref->>'specId' AND r.version_id::text=ref->>'versionId'
    AND r.created_at<=v.created_at AND r.expires_at>=v.expires_at AND r.result_json->>'status'='qualified' AND s.status='published' AND s.published_version_id=r.version_id
    AND r.result_json->'points'->((ref->>'pointIndex')::integer)->'value'=captured->'facts'->'value') THEN
   RAISE EXCEPTION 'decision_exact_forecast_evidence_required' USING ERRCODE='23514'; END IF;
 ELSIF ref->>'type'='scenario_run' THEN
  IF NEW.forecast_run_id IS NOT NULL OR NEW.scenario_run_id::text IS DISTINCT FROM ref->>'id' OR NOT EXISTS(
   SELECT 1 FROM business_scenario_runs r JOIN business_scenarios s ON s.company_id=r.company_id AND s.id=r.scenario_id,
    LATERAL jsonb_array_elements(r.result_json->'cases') c, LATERAL jsonb_array_elements(c->'outputs') o
   WHERE r.company_id=NEW.company_id AND r.id=NEW.scenario_run_id AND r.scenario_id::text=ref->>'scenarioId' AND r.version_id::text=ref->>'versionId'
    AND r.created_at<=v.created_at AND r.expires_at>=v.expires_at AND r.result_json->>'status' IN ('calculated','inconclusive') AND s.status='published' AND s.published_version_id=r.version_id
    AND c->>'key'=ref->>'caseKey' AND o->>'key'=ref->>'outputKey' AND o->'nominal'=captured->'facts'->'nominal') THEN
   RAISE EXCEPTION 'decision_exact_scenario_evidence_required' USING ERRCODE='23514'; END IF;
 ELSE RAISE EXCEPTION 'decision_unsupported_calculation_evidence' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_decision_calculation_pin_guard BEFORE INSERT OR UPDATE OR DELETE ON decision_calculation_pins FOR EACH ROW EXECUTE FUNCTION aw_decision_calculation_pin_guard();
--> statement-breakpoint
CREATE FUNCTION aw_decision_erased_calculation_pin() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE manifest uuid;
BEGIN
 SELECT lineage_manifest_id INTO manifest FROM decision_context_versions WHERE company_id=OLD.company_id AND id=OLD.context_version_id;
 IF manifest IS NOT NULL THEN DELETE FROM analytical_lineage_manifests WHERE company_id=OLD.company_id AND id=manifest; END IF;
 RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_decision_erased_calculation_pin AFTER DELETE ON decision_calculation_pins FOR EACH ROW EXECUTE FUNCTION aw_decision_erased_calculation_pin();
