ALTER TABLE "analytical_source_suppressions" DROP CONSTRAINT "analytical_source_suppressions_type_check";--> statement-breakpoint
ALTER TABLE "analytical_source_suppressions" ADD CONSTRAINT "analytical_source_suppressions_type_check" CHECK ("analytical_source_suppressions"."input_type" in ('issue','project','goal'));--> statement-breakpoint
CREATE TRIGGER aw_metric_target_version_immutable BEFORE UPDATE ON business_metric_target_versions
FOR EACH ROW EXECUTE FUNCTION aw_analytical_snapshot_immutable();
--> statement-breakpoint
CREATE TRIGGER aw_metric_target_approval_immutable BEFORE UPDATE ON business_metric_target_approvals
FOR EACH ROW EXECUTE FUNCTION aw_analytical_snapshot_immutable();
--> statement-breakpoint
CREATE FUNCTION aw_metric_target_admission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('business-events:' || NEW.company_id::text, 0));
  IF TG_OP='UPDATE' AND (NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW.metric_id IS DISTINCT FROM OLD.metric_id OR NEW.scope_type IS DISTINCT FROM OLD.scope_type
    OR NEW.goal_id IS DISTINCT FROM OLD.goal_id OR NEW.project_id IS DISTINCT FROM OLD.project_id) THEN
    RAISE EXCEPTION 'Target ownership and metric identity are immutable' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM analytical_source_suppressions s WHERE s.company_id=NEW.company_id
    AND ((s.input_type='goal' AND s.input_ref=NEW.goal_id) OR (s.input_type='project' AND s.input_ref=NEW.project_id))) THEN
    RAISE EXCEPTION 'Target native owner was erased' USING ERRCODE='23514';
  END IF;
  IF NEW.approved_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM business_metric_target_approvals a
    WHERE a.company_id=NEW.company_id AND a.target_id=NEW.id AND a.version_id=NEW.approved_version_id) THEN
    RAISE EXCEPTION 'Target approval evidence is unavailable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER aw_metric_target_admission BEFORE INSERT OR UPDATE ON business_metric_targets
FOR EACH ROW EXECUTE FUNCTION aw_metric_target_admission();
--> statement-breakpoint
CREATE FUNCTION aw_metric_target_version_admission() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t business_metric_targets;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('business-events:' || NEW.company_id::text, 0));
  SELECT * INTO t FROM business_metric_targets WHERE company_id=NEW.company_id AND id=NEW.target_id;
  IF t.id IS NULL OR t.metric_id<>NEW.metric_id OR NEW.definition_json->>'metricId' IS DISTINCT FROM NEW.metric_id::text
    OR NEW.definition_json->>'metricVersionId' IS DISTINCT FROM NEW.metric_version_id::text
    OR NEW.definition_json->'scope'->>'type' IS DISTINCT FROM t.scope_type
    OR NEW.definition_json->'scope'->>'goalId' IS DISTINCT FROM t.goal_id::text
    OR NEW.definition_json->'scope'->>'projectId' IS DISTINCT FROM t.project_id::text
    OR (t.scope_type='portfolio' AND NEW.definition_json->'scope'->>'mode' IS DISTINCT FROM 'company_unit')
  THEN RAISE EXCEPTION 'Target version differs from its native commitment identity' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER aw_metric_target_version_admission BEFORE INSERT ON business_metric_target_versions
FOR EACH ROW EXECUTE FUNCTION aw_metric_target_version_admission();
