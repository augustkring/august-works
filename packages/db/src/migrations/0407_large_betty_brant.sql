CREATE TABLE "decision_experiment_pins" (
	"company_id" uuid NOT NULL,
	"decision_id" uuid NOT NULL,
	"context_version_id" uuid NOT NULL,
	"material_key" text NOT NULL,
	"experiment_id" uuid NOT NULL,
	"experiment_version_id" uuid NOT NULL,
	"analysis_id" uuid NOT NULL,
	"interpretation_id" uuid NOT NULL,
	"source_hash" text NOT NULL,
	CONSTRAINT "decision_experiment_pins_key_uq" UNIQUE("company_id","context_version_id","material_key"),
	CONSTRAINT "decision_experiment_pins_hash_check" CHECK ("decision_experiment_pins"."source_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "business_experiment_interpretations" ADD CONSTRAINT "business_experiment_interpretations_tenant_uq" UNIQUE("company_id","experiment_id","version_id","analysis_id","id");--> statement-breakpoint
ALTER TABLE "decision_experiment_pins" ADD CONSTRAINT "decision_experiment_pins_version_fk" FOREIGN KEY ("company_id","decision_id","context_version_id") REFERENCES "public"."decision_context_versions"("company_id","decision_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_experiment_pins" ADD CONSTRAINT "decision_experiment_pins_analysis_fk" FOREIGN KEY ("company_id","experiment_id","experiment_version_id","analysis_id") REFERENCES "public"."business_experiment_analyses"("company_id","experiment_id","version_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_experiment_pins" ADD CONSTRAINT "decision_experiment_pins_interpretation_fk" FOREIGN KEY ("company_id","experiment_id","experiment_version_id","analysis_id","interpretation_id") REFERENCES "public"."business_experiment_interpretations"("company_id","experiment_id","version_id","analysis_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE FUNCTION aw_decision_experiment_pin_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v decision_context_versions%ROWTYPE; ref jsonb; captured jsonb;
BEGIN
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM decision_context_versions WHERE company_id=OLD.company_id AND id=OLD.context_version_id)
   AND EXISTS(SELECT 1 FROM business_experiment_analyses WHERE company_id=OLD.company_id AND id=OLD.analysis_id)
   AND EXISTS(SELECT 1 FROM business_experiment_interpretations WHERE company_id=OLD.company_id AND id=OLD.interpretation_id) THEN
   RAISE EXCEPTION 'decision_experiment_pin_immutable' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'decision_experiment_pin_immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO v FROM decision_context_versions WHERE company_id=NEW.company_id AND decision_id=NEW.decision_id AND id=NEW.context_version_id;
 SELECT value->'source' INTO ref FROM jsonb_array_elements(v.definition_json->'evidence') WHERE value->>'key'=NEW.material_key;
 SELECT value INTO captured FROM jsonb_array_elements(v.captured_evidence_json) WHERE value->>'key'=NEW.material_key;
 IF ref IS NULL OR ref->>'type' IS DISTINCT FROM 'experiment_analysis'
  OR captured->'source' IS DISTINCT FROM ref OR captured->>'sourceHash' IS DISTINCT FROM NEW.source_hash
  OR NEW.analysis_id::text IS DISTINCT FROM ref->>'id' OR NEW.interpretation_id::text IS DISTINCT FROM ref->>'interpretationId'
  OR NEW.experiment_id::text IS DISTINCT FROM ref->>'experimentId' OR NEW.experiment_version_id::text IS DISTINCT FROM ref->>'versionId'
  OR NOT EXISTS(SELECT 1 FROM business_experiment_analyses a
   JOIN business_experiment_interpretations i ON i.company_id=a.company_id AND i.experiment_id=a.experiment_id AND i.version_id=a.version_id AND i.analysis_id=a.id
   JOIN business_experiment_versions p ON p.company_id=a.company_id AND p.experiment_id=a.experiment_id AND p.id=a.version_id
   JOIN business_experiments e ON e.company_id=p.company_id AND e.id=p.experiment_id
   WHERE a.company_id=NEW.company_id AND a.id=NEW.analysis_id AND i.id=NEW.interpretation_id
    AND a.analyzed_at<=i.interpreted_at AND i.interpreted_at<=v.created_at AND p.expires_at>=v.expires_at
    AND e.current_version_id=p.id AND e.state IN ('decided','inconclusive','invalid')
    AND a.result_json->>'status'=captured->'facts'->>'status' AND i.conclusion=captured->'facts'->>'humanConclusion'
    AND captured->'facts'->>'executionAuthority'='advisory_only') THEN
  RAISE EXCEPTION 'decision_exact_experiment_evidence_required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_decision_experiment_pin_guard BEFORE INSERT OR UPDATE OR DELETE ON decision_experiment_pins FOR EACH ROW EXECUTE FUNCTION aw_decision_experiment_pin_guard();
--> statement-breakpoint
CREATE TRIGGER aw_decision_erased_experiment_pin AFTER DELETE ON decision_experiment_pins FOR EACH ROW EXECUTE FUNCTION aw_decision_erased_calculation_pin();
--> statement-breakpoint
CREATE FUNCTION aw_decision_experiment_material_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v decision_context_versions%ROWTYPE;
BEGIN
 SELECT * INTO v FROM decision_context_versions WHERE company_id=NEW.company_id AND decision_id=NEW.decision_id AND id=NEW.id;
 IF NOT FOUND THEN RETURN NEW; END IF;
 IF (SELECT count(*) FROM decision_experiment_pins WHERE company_id=v.company_id AND context_version_id=v.id)
  <> (SELECT count(*) FROM jsonb_array_elements(v.definition_json->'evidence') e WHERE e->'source'->>'type'='experiment_analysis') THEN
  RAISE EXCEPTION 'decision_experiment_material_incomplete' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER aw_decision_experiment_material_complete AFTER INSERT ON decision_context_versions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION aw_decision_experiment_material_complete();
