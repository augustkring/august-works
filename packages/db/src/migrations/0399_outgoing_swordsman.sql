CREATE TABLE "forecast_backtests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"spec_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"lineage_manifest_id" uuid NOT NULL,
	"definition_hash" text NOT NULL,
	"input_hash" text NOT NULL,
	"content_hash" text NOT NULL,
	"series_json" jsonb NOT NULL,
	"result_json" jsonb NOT NULL,
	"cutoff" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "forecast_backtests_tenant_uq" UNIQUE("company_id","spec_id","version_id","id"),
	CONSTRAINT "forecast_backtests_content_check" CHECK ("forecast_backtests"."definition_hash" ~ '^[0-9a-f]{64}$' and "forecast_backtests"."input_hash" ~ '^[0-9a-f]{64}$' and "forecast_backtests"."content_hash" ~ '^[0-9a-f]{64}$' and "forecast_backtests"."expires_at">"forecast_backtests"."created_at" and "forecast_backtests"."cutoff"<="forecast_backtests"."created_at" and jsonb_typeof("forecast_backtests"."series_json")='array' and jsonb_typeof("forecast_backtests"."result_json")='object')
);
--> statement-breakpoint
CREATE TABLE "forecast_publications" (
	"company_id" uuid NOT NULL,
	"spec_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"backtest_id" uuid NOT NULL,
	"published_by" text NOT NULL,
	"rationale" text NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	CONSTRAINT "forecast_publications_version_uq" UNIQUE("company_id","spec_id","version_id"),
	CONSTRAINT "forecast_publications_rationale_check" CHECK (length(btrim("forecast_publications"."rationale")) between 10 and 2000)
);
--> statement-breakpoint
CREATE TABLE "forecast_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"spec_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"lineage_manifest_id" uuid NOT NULL,
	"definition_hash" text NOT NULL,
	"input_hash" text NOT NULL,
	"content_hash" text NOT NULL,
	"series_json" jsonb NOT NULL,
	"result_json" jsonb NOT NULL,
	"cutoff" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "forecast_runs_tenant_uq" UNIQUE("company_id","id"),
	CONSTRAINT "forecast_runs_content_check" CHECK ("forecast_runs"."definition_hash" ~ '^[0-9a-f]{64}$' and "forecast_runs"."input_hash" ~ '^[0-9a-f]{64}$' and "forecast_runs"."content_hash" ~ '^[0-9a-f]{64}$' and "forecast_runs"."expires_at">"forecast_runs"."created_at" and "forecast_runs"."cutoff"<="forecast_runs"."created_at" and jsonb_typeof("forecast_runs"."series_json")='array' and jsonb_typeof("forecast_runs"."result_json")='object')
);
--> statement-breakpoint
CREATE TABLE "forecast_spec_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"spec_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"definition_json" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"lineage_manifest_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "forecast_spec_versions_tenant_uq" UNIQUE("company_id","spec_id","id"),
	CONSTRAINT "forecast_spec_versions_revision_uq" UNIQUE("company_id","spec_id","revision"),
	CONSTRAINT "forecast_spec_versions_content_check" CHECK ("forecast_spec_versions"."revision">0 and "forecast_spec_versions"."content_hash" ~ '^[0-9a-f]{64}$' and jsonb_typeof("forecast_spec_versions"."definition_json")='object' and "forecast_spec_versions"."expires_at">"forecast_spec_versions"."created_at")
);
--> statement-breakpoint
CREATE TABLE "forecast_specs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"spec_key" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_version_id" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "forecast_specs_tenant_uq" UNIQUE("company_id","id"),
	CONSTRAINT "forecast_specs_key_uq" UNIQUE("company_id","spec_key"),
	CONSTRAINT "forecast_specs_state_check" CHECK ("forecast_specs"."revision">0 and "forecast_specs"."status" in ('draft','published','retired') and ("forecast_specs"."status"<>'published' or "forecast_specs"."published_version_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "forecast_backtests" ADD CONSTRAINT "forecast_backtests_version_fk" FOREIGN KEY ("company_id","spec_id","version_id") REFERENCES "public"."forecast_spec_versions"("company_id","spec_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_backtests" ADD CONSTRAINT "forecast_backtests_lineage_fk" FOREIGN KEY ("company_id","lineage_manifest_id") REFERENCES "public"."analytical_lineage_manifests"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_publications" ADD CONSTRAINT "forecast_publications_backtest_fk" FOREIGN KEY ("company_id","spec_id","version_id","backtest_id") REFERENCES "public"."forecast_backtests"("company_id","spec_id","version_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_runs" ADD CONSTRAINT "forecast_runs_version_fk" FOREIGN KEY ("company_id","spec_id","version_id") REFERENCES "public"."forecast_spec_versions"("company_id","spec_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_runs" ADD CONSTRAINT "forecast_runs_lineage_fk" FOREIGN KEY ("company_id","lineage_manifest_id") REFERENCES "public"."analytical_lineage_manifests"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_spec_versions" ADD CONSTRAINT "forecast_spec_versions_spec_fk" FOREIGN KEY ("company_id","spec_id") REFERENCES "public"."forecast_specs"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_spec_versions" ADD CONSTRAINT "forecast_spec_versions_lineage_fk" FOREIGN KEY ("company_id","lineage_manifest_id") REFERENCES "public"."analytical_lineage_manifests"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_specs" ADD CONSTRAINT "forecast_specs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_specs" ADD CONSTRAINT "forecast_specs_published_fk" FOREIGN KEY ("company_id","id","published_version_id") REFERENCES "public"."forecast_spec_versions"("company_id","spec_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "forecast_backtests_spec_time_idx" ON "forecast_backtests" USING btree ("company_id","spec_id","created_at","id");--> statement-breakpoint
CREATE INDEX "forecast_runs_spec_time_idx" ON "forecast_runs" USING btree ("company_id","spec_id","created_at","id");--> statement-breakpoint
CREATE FUNCTION aw_forecast_root_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.revision<>1 OR NEW.status<>'draft' OR NEW.published_version_id IS NOT NULL THEN
   RAISE EXCEPTION 'forecast_initial_draft_required' USING ERRCODE='23514'; END IF;
 ELSE
  IF ROW(NEW.id,NEW.company_id,NEW.spec_key,NEW.created_by,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.company_id,OLD.spec_key,OLD.created_by,OLD.created_at)
   OR NEW.revision<>OLD.revision+1 OR NEW.updated_at<OLD.updated_at OR OLD.status='retired'
   OR (NEW.status='draft' AND OLD.status<>'draft') OR (NEW.status='retired' AND NEW.published_version_id IS NOT NULL)
   THEN RAISE EXCEPTION 'forecast_revision_transition_not_admitted' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_forecast_root_guard BEFORE INSERT OR UPDATE ON forecast_specs FOR EACH ROW EXECUTE FUNCTION aw_forecast_root_guard();
--> statement-breakpoint
CREATE FUNCTION aw_forecast_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM forecast_specs WHERE company_id=OLD.company_id AND id=OLD.spec_id)
   AND EXISTS(SELECT 1 FROM analytical_lineage_manifests WHERE company_id=OLD.company_id AND id=OLD.lineage_manifest_id) THEN
   RAISE EXCEPTION 'forecast_definition_immutable' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'forecast_definition_immutable' USING ERRCODE='23514'; END IF;
 IF NEW.definition_json->>'provider' IS DISTINCT FROM 'aw_native' OR NEW.definition_json->>'purpose' IS DISTINCT FROM 'management_intelligence'
  OR NOT EXISTS(SELECT 1 FROM forecast_specs WHERE company_id=NEW.company_id AND id=NEW.spec_id AND status<>'retired' AND revision=NEW.revision AND updated_at=NEW.created_at)
  OR NOT EXISTS(SELECT 1 FROM analytical_lineage_manifests WHERE company_id=NEW.company_id AND id=NEW.lineage_manifest_id AND analysis_type='forecast_specification'
    AND analysis_ref=NEW.id AND definition_hash=NEW.content_hash AND created_at=NEW.created_at AND expires_at=NEW.expires_at)
  OR NOT EXISTS(SELECT 1 FROM business_metric_versions v JOIN business_metrics m ON m.company_id=v.company_id AND m.id=v.metric_id
    WHERE v.company_id=NEW.company_id AND v.metric_id=(NEW.definition_json->>'metricId')::uuid AND v.id=(NEW.definition_json->>'metricVersionId')::uuid
    AND m.status='published' AND m.published_version_id=v.id AND v.created_at<=NEW.created_at)
  THEN RAISE EXCEPTION 'forecast_exact_native_definition_required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_forecast_version_guard BEFORE INSERT OR UPDATE OR DELETE ON forecast_spec_versions FOR EACH ROW EXECUTE FUNCTION aw_forecast_version_guard();
--> statement-breakpoint
CREATE FUNCTION aw_forecast_artifact_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
  OR NEW.result_json->>'engineVersion' IS DISTINCT FROM 'aw-native-business-forecast-v1'
  OR coalesce(NEW.result_json->>'status','') NOT IN ('qualified','not_qualified','data_not_ready')
  OR NEW.result_json->'uncertainty'->>'method' IS DISTINCT FROM 'unavailable' OR NEW.result_json->'uncertainty'->'coverageLevel' IS DISTINCT FROM 'null'::jsonb
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
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.result_json->'points') predicted WHERE predicted->'interval' IS DISTINCT FROM 'null'::jsonb OR (predicted->>'from')::timestamptz<NEW.cutoff
    OR (predicted->>'value')::numeric<0 OR ((SELECT definition_json->>'valueType' FROM business_metric_versions WHERE company_id=NEW.company_id AND id=(v.definition_json->>'metricVersionId')::uuid)='ratio' AND (predicted->>'value')::numeric>1))) THEN
  RAISE EXCEPTION 'forecast_qualified_prediction_policy_required' USING ERRCODE='23514'; END IF;
 IF artifact_kind='forecast_run' AND NOT EXISTS(SELECT 1 FROM forecast_specs r JOIN forecast_publications pub ON pub.company_id=r.company_id AND pub.spec_id=r.id AND pub.version_id=r.published_version_id
   JOIN forecast_backtests b ON b.company_id=pub.company_id AND b.id=pub.backtest_id
   WHERE r.company_id=NEW.company_id AND r.id=NEW.spec_id AND r.status='published' AND r.published_version_id=NEW.version_id AND pub.published_at<=NEW.created_at
    AND b.expires_at>NEW.created_at AND b.result_json->>'status'='qualified') THEN
   RAISE EXCEPTION 'forecast_run_human_publication_required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_forecast_backtest_guard BEFORE INSERT OR UPDATE OR DELETE ON forecast_backtests FOR EACH ROW EXECUTE FUNCTION aw_forecast_artifact_guard();
--> statement-breakpoint
CREATE TRIGGER aw_forecast_run_guard BEFORE INSERT OR UPDATE OR DELETE ON forecast_runs FOR EACH ROW EXECUTE FUNCTION aw_forecast_artifact_guard();
--> statement-breakpoint
CREATE FUNCTION aw_forecast_publication_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM forecast_specs WHERE company_id=OLD.company_id AND id=OLD.spec_id)
   AND EXISTS(SELECT 1 FROM forecast_backtests WHERE company_id=OLD.company_id AND id=OLD.backtest_id) THEN
   RAISE EXCEPTION 'forecast_human_publication_immutable' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'forecast_human_publication_immutable' USING ERRCODE='23514'; END IF;
 IF length(btrim(NEW.published_by)) NOT BETWEEN 1 AND 200 OR NOT EXISTS(
  SELECT 1 FROM forecast_specs r JOIN forecast_spec_versions v ON v.company_id=r.company_id AND v.spec_id=r.id
   JOIN forecast_backtests b ON b.company_id=v.company_id AND b.version_id=v.id
  WHERE r.company_id=NEW.company_id AND r.id=NEW.spec_id AND r.status<>'retired' AND v.id=NEW.version_id AND v.revision=r.revision
   AND b.id=NEW.backtest_id AND b.result_json->>'status'='qualified' AND b.definition_hash=v.content_hash
   AND b.created_at<=NEW.published_at AND b.expires_at>NEW.published_at AND v.expires_at>NEW.published_at
 ) THEN RAISE EXCEPTION 'forecast_qualified_backtest_publication_required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_forecast_publication_guard BEFORE INSERT OR UPDATE OR DELETE ON forecast_publications FOR EACH ROW EXECUTE FUNCTION aw_forecast_publication_guard();
--> statement-breakpoint
CREATE FUNCTION aw_forecast_root_proof_required() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r forecast_specs%ROWTYPE;
BEGIN
 SELECT * INTO r FROM forecast_specs WHERE company_id=NEW.company_id AND id=NEW.id;
 IF r.id IS NULL THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM forecast_spec_versions WHERE company_id=r.company_id AND spec_id=r.id)
  OR r.status='published' AND NOT EXISTS(SELECT 1 FROM forecast_publications WHERE company_id=r.company_id AND spec_id=r.id AND version_id=r.published_version_id)
  OR r.status='draft' AND r.published_version_id IS NOT NULL
  OR r.status='retired' AND r.published_version_id IS NOT NULL
  OR r.status<>'retired' AND NOT EXISTS(SELECT 1 FROM forecast_spec_versions v WHERE v.company_id=r.company_id AND v.spec_id=r.id AND v.revision=r.revision)
   AND NOT EXISTS(SELECT 1 FROM forecast_publications p JOIN forecast_spec_versions v ON v.company_id=p.company_id AND v.id=p.version_id WHERE p.company_id=r.company_id AND p.spec_id=r.id AND p.version_id=r.published_version_id AND p.published_at=r.updated_at AND v.revision=r.revision-1) THEN
   RAISE EXCEPTION 'forecast_native_definition_and_human_publication_required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER aw_forecast_root_proof_required AFTER INSERT OR UPDATE ON forecast_specs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION aw_forecast_root_proof_required();
--> statement-breakpoint
CREATE FUNCTION aw_forecast_erased_publication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 DELETE FROM forecast_specs WHERE company_id=OLD.company_id AND id=OLD.spec_id AND published_version_id=OLD.version_id;
 RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_forecast_erased_publication AFTER DELETE ON forecast_publications FOR EACH ROW EXECUTE FUNCTION aw_forecast_erased_publication();
--> statement-breakpoint
CREATE FUNCTION aw_forecast_erased_last_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 DELETE FROM forecast_specs r WHERE r.company_id=OLD.company_id AND r.id=OLD.spec_id
  AND NOT EXISTS(SELECT 1 FROM forecast_spec_versions v WHERE v.company_id=r.company_id AND v.spec_id=r.id);
 RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_forecast_erased_last_version AFTER DELETE ON forecast_spec_versions FOR EACH ROW EXECUTE FUNCTION aw_forecast_erased_last_version();
