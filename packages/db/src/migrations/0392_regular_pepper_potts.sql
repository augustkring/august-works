ALTER TABLE "analytical_lineage_edges" DROP CONSTRAINT "analytical_lineage_edges_type_check";--> statement-breakpoint
ALTER TABLE "analytical_lineage_edges" ADD CONSTRAINT "analytical_lineage_edges_type_check" CHECK ("analytical_lineage_edges"."input_type" in ('issue','project','metric_version','governance_obligation','business_event_source') and "analytical_lineage_edges"."relationship" in ('source','definition','policy'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_analytical_edge_admission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('business-events:' || NEW.company_id::text, 0));
  IF EXISTS(SELECT 1 FROM analytical_source_suppressions s WHERE s.company_id=NEW.company_id AND s.input_type=NEW.input_type AND s.input_ref=NEW.input_ref) THEN
    RAISE EXCEPTION 'Analytical source was erased' USING ERRCODE='23514';
  END IF;
  IF NOT (CASE NEW.input_type
    WHEN 'issue' THEN EXISTS(SELECT 1 FROM issues WHERE company_id=NEW.company_id AND id=NEW.input_ref)
    WHEN 'project' THEN EXISTS(SELECT 1 FROM projects WHERE company_id=NEW.company_id AND id=NEW.input_ref)
    WHEN 'metric_version' THEN EXISTS(SELECT 1 FROM business_metric_versions WHERE company_id=NEW.company_id AND id=NEW.input_ref)
    WHEN 'business_event_source' THEN EXISTS(SELECT 1 FROM business_events e JOIN activity_log a ON a.company_id=e.company_id AND a.id=e.source_ref
      WHERE e.company_id=NEW.company_id AND e.source_ref=NEW.input_ref AND e.source_hash=NEW.input_hash
        AND e.tombstoned_at IS NULL AND e.expires_at>now() AND e.source_version='aw-activity-v2'
        AND NOT EXISTS(SELECT 1 FROM business_event_suppressions s WHERE s.company_id=e.company_id AND s.source_ref=e.source_ref))
    WHEN 'governance_obligation' THEN EXISTS(SELECT 1 FROM governance_obligations WHERE company_id=NEW.company_id AND id=NEW.input_ref)
    ELSE false END) THEN
    RAISE EXCEPTION 'Analytical source is unavailable in this company' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
