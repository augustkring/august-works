CREATE TABLE "business_scenario_publications" (
	"company_id" uuid NOT NULL,
	"scenario_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"published_by" text NOT NULL,
	"rationale" text NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	CONSTRAINT "business_scenario_publications_version_uq" UNIQUE("company_id","scenario_id","version_id"),
	CONSTRAINT "business_scenario_publications_rationale_check" CHECK (length(btrim("business_scenario_publications"."rationale")) between 10 and 2000)
);
--> statement-breakpoint
CREATE TABLE "business_scenario_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"scenario_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"lineage_manifest_id" uuid NOT NULL,
	"definition_hash" text NOT NULL,
	"input_hash" text NOT NULL,
	"content_hash" text NOT NULL,
	"result_json" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "business_scenario_runs_tenant_uq" UNIQUE("company_id","id"),
	CONSTRAINT "business_scenario_runs_content_check" CHECK ("business_scenario_runs"."definition_hash" ~ '^[0-9a-f]{64}$' and "business_scenario_runs"."input_hash" ~ '^[0-9a-f]{64}$' and "business_scenario_runs"."content_hash" ~ '^[0-9a-f]{64}$' and jsonb_typeof("business_scenario_runs"."result_json")='object' and "business_scenario_runs"."expires_at">"business_scenario_runs"."created_at")
);
--> statement-breakpoint
CREATE TABLE "business_scenario_source_pins" (
	"company_id" uuid NOT NULL,
	"scenario_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"input_key" text NOT NULL,
	"metric_observation_id" uuid,
	"forecast_run_id" uuid,
	CONSTRAINT "business_scenario_source_pins_input_uq" UNIQUE("company_id","scenario_id","version_id","input_key"),
	CONSTRAINT "business_scenario_source_pins_type_check" CHECK (("business_scenario_source_pins"."metric_observation_id" is null) <> ("business_scenario_source_pins"."forecast_run_id" is null))
);
--> statement-breakpoint
CREATE TABLE "business_scenario_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"scenario_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"definition_json" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"input_hash" text NOT NULL,
	"inputs_json" jsonb NOT NULL,
	"lineage_manifest_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "business_scenario_versions_tenant_uq" UNIQUE("company_id","scenario_id","id"),
	CONSTRAINT "business_scenario_versions_revision_uq" UNIQUE("company_id","scenario_id","revision"),
	CONSTRAINT "business_scenario_versions_content_check" CHECK ("business_scenario_versions"."revision">0 and "business_scenario_versions"."content_hash" ~ '^[0-9a-f]{64}$' and "business_scenario_versions"."input_hash" ~ '^[0-9a-f]{64}$' and jsonb_typeof("business_scenario_versions"."definition_json")='object' and jsonb_typeof("business_scenario_versions"."inputs_json")='array' and "business_scenario_versions"."expires_at">"business_scenario_versions"."created_at")
);
--> statement-breakpoint
CREATE TABLE "business_scenarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"scenario_key" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_version_id" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_scenarios_tenant_uq" UNIQUE("company_id","id"),
	CONSTRAINT "business_scenarios_key_uq" UNIQUE("company_id","scenario_key"),
	CONSTRAINT "business_scenarios_state_check" CHECK ("business_scenarios"."revision">0 and "business_scenarios"."status" in ('draft','published','retired') and ("business_scenarios"."status"<>'published' or "business_scenarios"."published_version_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "business_scenario_publications" ADD CONSTRAINT "business_scenario_publications_version_fk" FOREIGN KEY ("company_id","scenario_id","version_id") REFERENCES "public"."business_scenario_versions"("company_id","scenario_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_scenario_runs" ADD CONSTRAINT "business_scenario_runs_version_fk" FOREIGN KEY ("company_id","scenario_id","version_id") REFERENCES "public"."business_scenario_versions"("company_id","scenario_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_scenario_runs" ADD CONSTRAINT "business_scenario_runs_lineage_fk" FOREIGN KEY ("company_id","lineage_manifest_id") REFERENCES "public"."analytical_lineage_manifests"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_scenario_source_pins" ADD CONSTRAINT "business_scenario_source_pins_version_fk" FOREIGN KEY ("company_id","scenario_id","version_id") REFERENCES "public"."business_scenario_versions"("company_id","scenario_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_scenario_source_pins" ADD CONSTRAINT "business_scenario_source_pins_metric_fk" FOREIGN KEY ("company_id","metric_observation_id") REFERENCES "public"."business_metric_observations"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_scenario_source_pins" ADD CONSTRAINT "business_scenario_source_pins_forecast_fk" FOREIGN KEY ("company_id","forecast_run_id") REFERENCES "public"."forecast_runs"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_scenario_versions" ADD CONSTRAINT "business_scenario_versions_root_fk" FOREIGN KEY ("company_id","scenario_id") REFERENCES "public"."business_scenarios"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_scenario_versions" ADD CONSTRAINT "business_scenario_versions_lineage_fk" FOREIGN KEY ("company_id","lineage_manifest_id") REFERENCES "public"."analytical_lineage_manifests"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_scenarios" ADD CONSTRAINT "business_scenarios_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_scenarios" ADD CONSTRAINT "business_scenarios_published_fk" FOREIGN KEY ("company_id","id","published_version_id") REFERENCES "public"."business_scenario_versions"("company_id","scenario_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "business_scenario_runs_time_idx" ON "business_scenario_runs" USING btree ("company_id","scenario_id","created_at","id");
--> statement-breakpoint
CREATE FUNCTION aw_scenario_root_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.revision<>1 OR NEW.status<>'draft' OR NEW.published_version_id IS NOT NULL THEN
   RAISE EXCEPTION 'scenario_initial_draft_required' USING ERRCODE='23514'; END IF;
 ELSE
  IF ROW(NEW.id,NEW.company_id,NEW.scenario_key,NEW.created_by,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.company_id,OLD.scenario_key,OLD.created_by,OLD.created_at)
   OR NEW.revision<>OLD.revision+1 OR NEW.updated_at<OLD.updated_at OR OLD.status='retired'
   OR (NEW.status='draft' AND OLD.status<>'draft') OR (NEW.status='retired' AND NEW.published_version_id IS NOT NULL) THEN
   RAISE EXCEPTION 'scenario_revision_transition_not_admitted' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_scenario_root_guard BEFORE INSERT OR UPDATE ON business_scenarios FOR EACH ROW EXECUTE FUNCTION aw_scenario_root_guard();
--> statement-breakpoint
CREATE FUNCTION aw_scenario_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pin jsonb; declaration jsonb; observation business_metric_observations%ROWTYPE; forecast forecast_runs%ROWTYPE; metric_definition jsonb; expected_unit jsonb;
BEGIN
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM business_scenarios WHERE company_id=OLD.company_id AND id=OLD.scenario_id)
   AND EXISTS(SELECT 1 FROM analytical_lineage_manifests WHERE company_id=OLD.company_id AND id=OLD.lineage_manifest_id)
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(OLD.inputs_json) item WHERE
    item->>'kind'='metric_observation' AND NOT EXISTS(SELECT 1 FROM business_metric_observations WHERE company_id=OLD.company_id AND id=(item->>'sourceId')::uuid)
    OR item->>'kind'='forecast_point' AND NOT EXISTS(SELECT 1 FROM forecast_runs WHERE company_id=OLD.company_id AND id=(item->>'sourceId')::uuid)) THEN
    RAISE EXCEPTION 'scenario_version_immutable' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'scenario_version_immutable' USING ERRCODE='23514'; END IF;
 IF NEW.definition_json->>'purpose' IS DISTINCT FROM 'management_intelligence'
  OR coalesce(NEW.definition_json->>'calculationType','') NOT IN ('formula','forecast_composition','bounded_monte_carlo')
  OR jsonb_array_length(NEW.inputs_json)>32 OR jsonb_array_length(NEW.inputs_json)<>jsonb_array_length(NEW.definition_json->'inputs')
  OR NOT EXISTS(SELECT 1 FROM business_scenarios WHERE company_id=NEW.company_id AND id=NEW.scenario_id AND status<>'retired' AND revision=NEW.revision AND updated_at=NEW.created_at)
  OR NOT EXISTS(SELECT 1 FROM analytical_lineage_manifests WHERE company_id=NEW.company_id AND id=NEW.lineage_manifest_id AND analysis_type='scenario_version'
   AND engine_version='aw-native-business-scenario-owner-v1' AND analysis_ref=NEW.id AND definition_hash=NEW.content_hash AND input_hash=NEW.input_hash AND created_at=NEW.created_at AND expires_at=NEW.expires_at)
  THEN RAISE EXCEPTION 'scenario_exact_native_version_required' USING ERRCODE='23514'; END IF;
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
CREATE TRIGGER aw_scenario_version_guard BEFORE INSERT OR UPDATE OR DELETE ON business_scenario_versions FOR EACH ROW EXECUTE FUNCTION aw_scenario_version_guard();
--> statement-breakpoint
CREATE FUNCTION aw_scenario_source_pin_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM business_scenario_versions WHERE company_id=OLD.company_id AND id=OLD.version_id)
   AND (OLD.metric_observation_id IS NOT NULL AND EXISTS(SELECT 1 FROM business_metric_observations WHERE company_id=OLD.company_id AND id=OLD.metric_observation_id)
    OR OLD.forecast_run_id IS NOT NULL AND EXISTS(SELECT 1 FROM forecast_runs WHERE company_id=OLD.company_id AND id=OLD.forecast_run_id)) THEN
   RAISE EXCEPTION 'scenario_source_pin_immutable' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' OR NOT EXISTS(SELECT 1 FROM business_scenario_versions v, jsonb_array_elements(v.definition_json->'inputs') item
  WHERE v.company_id=NEW.company_id AND v.scenario_id=NEW.scenario_id AND v.id=NEW.version_id AND item->>'key'=NEW.input_key
   AND (item->>'kind'='metric_observation' AND item->>'observationId'=NEW.metric_observation_id::text AND NEW.forecast_run_id IS NULL
    OR item->>'kind'='forecast_point' AND item->>'runId'=NEW.forecast_run_id::text AND NEW.metric_observation_id IS NULL)) THEN
   RAISE EXCEPTION 'scenario_exact_source_pin_required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_scenario_source_pin_guard BEFORE INSERT OR UPDATE OR DELETE ON business_scenario_source_pins FOR EACH ROW EXECUTE FUNCTION aw_scenario_source_pin_guard();
--> statement-breakpoint
CREATE FUNCTION aw_scenario_version_pins_required() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v business_scenario_versions%ROWTYPE;
BEGIN
 SELECT * INTO v FROM business_scenario_versions WHERE company_id=NEW.company_id AND id=NEW.id;
 IF v.id IS NOT NULL AND (SELECT count(*) FROM business_scenario_source_pins WHERE company_id=v.company_id AND version_id=v.id)<>jsonb_array_length(v.definition_json->'inputs') THEN
  RAISE EXCEPTION 'scenario_complete_source_pins_required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER aw_scenario_version_pins_required AFTER INSERT ON business_scenario_versions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION aw_scenario_version_pins_required();
--> statement-breakpoint
CREATE FUNCTION aw_scenario_publication_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM business_scenarios WHERE company_id=OLD.company_id AND id=OLD.scenario_id)
   AND EXISTS(SELECT 1 FROM business_scenario_versions WHERE company_id=OLD.company_id AND id=OLD.version_id) THEN
   RAISE EXCEPTION 'scenario_publication_immutable' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' OR length(btrim(NEW.published_by)) NOT BETWEEN 1 AND 200 OR NOT EXISTS(
  SELECT 1 FROM business_scenarios r JOIN business_scenario_versions v ON v.company_id=r.company_id AND v.scenario_id=r.id
  WHERE r.company_id=NEW.company_id AND r.id=NEW.scenario_id AND r.status<>'retired' AND v.id=NEW.version_id AND v.revision=r.revision
   AND v.created_at<=NEW.published_at AND v.expires_at>NEW.published_at) THEN
   RAISE EXCEPTION 'scenario_human_latest_version_publication_required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_scenario_publication_guard BEFORE INSERT OR UPDATE OR DELETE ON business_scenario_publications FOR EACH ROW EXECUTE FUNCTION aw_scenario_publication_guard();
--> statement-breakpoint
CREATE FUNCTION aw_scenario_run_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v business_scenario_versions%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM business_scenario_versions WHERE company_id=OLD.company_id AND id=OLD.version_id)
   AND EXISTS(SELECT 1 FROM analytical_lineage_manifests WHERE company_id=OLD.company_id AND id=OLD.lineage_manifest_id) THEN
   RAISE EXCEPTION 'scenario_run_immutable' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'scenario_run_immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO v FROM business_scenario_versions WHERE company_id=NEW.company_id AND scenario_id=NEW.scenario_id AND id=NEW.version_id;
 IF v.id IS NULL OR v.content_hash IS DISTINCT FROM NEW.definition_hash OR v.input_hash IS DISTINCT FROM NEW.input_hash OR v.created_at>NEW.created_at OR v.expires_at<NEW.expires_at
  OR NEW.result_json->>'definitionHash' IS DISTINCT FROM NEW.definition_hash OR NEW.result_json->>'inputHash' IS DISTINCT FROM NEW.input_hash
  OR NEW.result_json->>'engineVersion' IS DISTINCT FROM 'aw-native-business-scenario-v1'
  OR coalesce(NEW.result_json->>'status','') NOT IN ('calculated','inconclusive','data_not_ready')
  OR NEW.result_json->'uncertainty'->'coverageLevel' IS DISTINCT FROM 'null'::jsonb
  OR (v.definition_json->>'calculationType'='bounded_monte_carlo') IS DISTINCT FROM (jsonb_typeof(NEW.result_json->'seed')='number')
  OR NOT EXISTS(SELECT 1 FROM business_scenarios r JOIN business_scenario_publications p ON p.company_id=r.company_id AND p.scenario_id=r.id AND p.version_id=r.published_version_id
   WHERE r.company_id=NEW.company_id AND r.id=NEW.scenario_id AND r.status='published' AND r.published_version_id=NEW.version_id AND p.published_at<=NEW.created_at)
  OR NOT EXISTS(SELECT 1 FROM analytical_lineage_manifests WHERE company_id=NEW.company_id AND id=NEW.lineage_manifest_id AND analysis_type='scenario_run'
   AND engine_version='aw-native-business-scenario-owner-v1' AND analysis_ref=NEW.id AND definition_hash=NEW.definition_hash AND input_hash=NEW.input_hash
   AND parameters_json->>'artifactHash'=NEW.content_hash AND created_at=NEW.created_at AND expires_at=NEW.expires_at) THEN
   RAISE EXCEPTION 'scenario_exact_human_published_run_required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_scenario_run_guard BEFORE INSERT OR UPDATE OR DELETE ON business_scenario_runs FOR EACH ROW EXECUTE FUNCTION aw_scenario_run_guard();
--> statement-breakpoint
CREATE FUNCTION aw_scenario_root_proof_required() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r business_scenarios%ROWTYPE;
BEGIN
 SELECT * INTO r FROM business_scenarios WHERE company_id=NEW.company_id AND id=NEW.id;
 IF r.id IS NULL THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM business_scenario_versions WHERE company_id=r.company_id AND scenario_id=r.id)
  OR r.status='published' AND NOT EXISTS(SELECT 1 FROM business_scenario_publications WHERE company_id=r.company_id AND scenario_id=r.id AND version_id=r.published_version_id)
  OR r.status IN ('draft','retired') AND r.published_version_id IS NOT NULL
  OR r.status<>'retired' AND NOT EXISTS(SELECT 1 FROM business_scenario_versions WHERE company_id=r.company_id AND scenario_id=r.id AND revision=r.revision)
   AND NOT EXISTS(SELECT 1 FROM business_scenario_publications p JOIN business_scenario_versions v ON v.company_id=p.company_id AND v.id=p.version_id
    WHERE p.company_id=r.company_id AND p.scenario_id=r.id AND p.version_id=r.published_version_id AND p.published_at=r.updated_at AND v.revision=r.revision-1) THEN
   RAISE EXCEPTION 'scenario_definition_and_publication_proof_required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER aw_scenario_root_proof_required AFTER INSERT OR UPDATE ON business_scenarios DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION aw_scenario_root_proof_required();
--> statement-breakpoint
CREATE FUNCTION aw_scenario_erased_source_pin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 DELETE FROM business_scenario_versions WHERE company_id=OLD.company_id AND id=OLD.version_id;
 RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_scenario_erased_source_pin AFTER DELETE ON business_scenario_source_pins FOR EACH ROW EXECUTE FUNCTION aw_scenario_erased_source_pin();
--> statement-breakpoint
CREATE FUNCTION aw_scenario_erased_last_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 DELETE FROM business_scenarios r WHERE r.company_id=OLD.company_id AND r.id=OLD.scenario_id
  AND NOT EXISTS(SELECT 1 FROM business_scenario_versions v WHERE v.company_id=r.company_id AND v.scenario_id=r.id);
 RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_scenario_erased_last_version AFTER DELETE ON business_scenario_versions FOR EACH ROW EXECUTE FUNCTION aw_scenario_erased_last_version();
