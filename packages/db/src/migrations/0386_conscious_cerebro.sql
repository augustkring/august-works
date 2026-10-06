CREATE TABLE "analytical_source_suppressions" (
	"company_id" uuid NOT NULL,
	"input_type" text NOT NULL,
	"input_ref" uuid NOT NULL,
	"suppressed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytical_source_suppressions_source_uq" UNIQUE("company_id","input_type","input_ref"),
	CONSTRAINT "analytical_source_suppressions_type_check" CHECK ("analytical_source_suppressions"."input_type" in ('issue','project'))
);
--> statement-breakpoint
ALTER TABLE "analytical_source_suppressions" ADD CONSTRAINT "analytical_source_suppressions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE FUNCTION aw_analytical_edge_admission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('business-events:' || NEW.company_id::text, 0));
  IF EXISTS(SELECT 1 FROM analytical_source_suppressions s WHERE s.company_id=NEW.company_id AND s.input_type=NEW.input_type AND s.input_ref=NEW.input_ref) THEN
    RAISE EXCEPTION 'Analytical source was erased' USING ERRCODE='23514';
  END IF;
  IF NOT (CASE NEW.input_type
    WHEN 'issue' THEN EXISTS(SELECT 1 FROM issues WHERE company_id=NEW.company_id AND id=NEW.input_ref)
    WHEN 'project' THEN EXISTS(SELECT 1 FROM projects WHERE company_id=NEW.company_id AND id=NEW.input_ref)
    WHEN 'metric_version' THEN EXISTS(SELECT 1 FROM business_metric_versions WHERE company_id=NEW.company_id AND id=NEW.input_ref)
    WHEN 'governance_obligation' THEN EXISTS(SELECT 1 FROM governance_obligations WHERE company_id=NEW.company_id AND id=NEW.input_ref)
    ELSE false END) THEN
    RAISE EXCEPTION 'Analytical source is unavailable in this company' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER aw_analytical_edge_admission BEFORE INSERT ON analytical_lineage_edges
FOR EACH ROW EXECUTE FUNCTION aw_analytical_edge_admission();
--> statement-breakpoint
CREATE FUNCTION aw_analytical_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Analytical evidence snapshots are immutable' USING ERRCODE='23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER aw_analytical_manifest_immutable BEFORE UPDATE ON analytical_lineage_manifests
FOR EACH ROW EXECUTE FUNCTION aw_analytical_snapshot_immutable();
--> statement-breakpoint
CREATE TRIGGER aw_analytical_edge_immutable BEFORE UPDATE ON analytical_lineage_edges
FOR EACH ROW EXECUTE FUNCTION aw_analytical_snapshot_immutable();
--> statement-breakpoint
CREATE TRIGGER aw_metric_observation_immutable BEFORE UPDATE ON business_metric_observations
FOR EACH ROW EXECUTE FUNCTION aw_analytical_snapshot_immutable();
--> statement-breakpoint
CREATE FUNCTION aw_metric_observation_lineage_admission() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m analytical_lineage_manifests; v business_metric_versions;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('business-events:' || NEW.company_id::text, 0));
  SELECT * INTO m FROM analytical_lineage_manifests WHERE company_id=NEW.company_id AND id=NEW.lineage_manifest_id;
  SELECT * INTO v FROM business_metric_versions WHERE company_id=NEW.company_id AND metric_id=NEW.metric_id AND id=NEW.version_id;
  IF m.id IS NULL OR v.id IS NULL OR m.analysis_type<>'business_metric' OR m.analysis_ref<>NEW.id
    OR m.input_hash<>NEW.input_hash OR m.definition_hash<>NEW.definition_hash OR v.content_hash<>NEW.definition_hash
    OR m.requested_by<>NEW.requested_by OR m.created_at<>NEW.observed_at
    OR NOT EXISTS(SELECT 1 FROM analytical_lineage_edges e WHERE e.company_id=NEW.company_id AND e.manifest_id=m.id AND e.input_type='metric_version' AND e.input_ref=NEW.version_id AND e.input_hash=NEW.definition_hash)
    OR EXISTS(SELECT 1 FROM analytical_lineage_edges e JOIN analytical_source_suppressions s ON s.company_id=e.company_id AND s.input_type=e.input_type AND s.input_ref=e.input_ref WHERE e.company_id=NEW.company_id AND e.manifest_id=m.id)
  THEN RAISE EXCEPTION 'Metric observation lineage is unavailable or inconsistent' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER aw_metric_observation_lineage_admission BEFORE INSERT ON business_metric_observations
FOR EACH ROW EXECUTE FUNCTION aw_metric_observation_lineage_admission();
--> statement-breakpoint
CREATE TRIGGER aw_metric_publication_immutable BEFORE UPDATE ON business_metric_publications
FOR EACH ROW EXECUTE FUNCTION aw_analytical_snapshot_immutable();
