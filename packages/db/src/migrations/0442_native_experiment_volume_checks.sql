-- Preserve the original exact native outcome checks without repeatedly decoding
-- the complete immutable analysis JSON for each outcome. Its original insert
-- guard binds completionReason to the immutable same-company completion receipt.
CREATE OR REPLACE FUNCTION aw_experiment_outcome_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a record; u business_experiment_assignments%ROWTYPE; v business_experiment_versions%ROWTYPE; i issues%ROWTYPE; p projects%ROWTYPE; metric business_metric_versions%ROWTYPE; expected_value integer;
BEGIN
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM business_experiment_versions WHERE company_id=OLD.company_id AND id=OLD.version_id)
   AND EXISTS(SELECT 1 FROM business_experiment_analyses WHERE company_id=OLD.company_id AND id=OLD.analysis_id)
   AND EXISTS(SELECT 1 FROM business_experiment_assignments WHERE company_id=OLD.company_id AND id=OLD.assignment_id)
   AND EXISTS(SELECT 1 FROM business_metric_versions WHERE company_id=OLD.company_id AND id=OLD.metric_version_id)
   AND EXISTS(SELECT 1 FROM analytical_lineage_manifests WHERE company_id=OLD.company_id AND id=OLD.lineage_manifest_id) THEN
   RAISE EXCEPTION 'experiment_outcome_immutable' USING ERRCODE='23514'; END IF; RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'experiment_outcome_immutable' USING ERRCODE='23514'; END IF;
 SELECT id, analyzed_at INTO a FROM business_experiment_analyses WHERE company_id=NEW.company_id AND experiment_id=NEW.experiment_id AND version_id=NEW.version_id AND id=NEW.analysis_id;
 SELECT * INTO u FROM business_experiment_assignments WHERE company_id=NEW.company_id AND experiment_id=NEW.experiment_id AND version_id=NEW.version_id AND id=NEW.assignment_id;
 SELECT * INTO v FROM business_experiment_versions WHERE company_id=NEW.company_id AND experiment_id=NEW.experiment_id AND id=NEW.version_id;
 SELECT * INTO metric FROM business_metric_versions WHERE company_id=NEW.company_id AND metric_id=NEW.metric_id AND id=NEW.metric_version_id;
 IF a.id IS NULL OR u.id IS NULL OR v.id IS NULL OR metric.id IS NULL OR NEW.captured_at<>a.analyzed_at OR NOT EXISTS(SELECT 1 FROM business_experiment_completions WHERE company_id=NEW.company_id AND experiment_id=NEW.experiment_id AND version_id=NEW.version_id AND reason='fixed_horizon')
  OR NOT EXISTS(SELECT 1 FROM business_experiments WHERE company_id=NEW.company_id AND id=NEW.experiment_id AND current_version_id=NEW.version_id AND state='analyzing')
  OR NOT EXISTS(SELECT 1 FROM business_experiment_metric_pins WHERE company_id=NEW.company_id AND version_id=NEW.version_id AND metric_key=NEW.metric_key AND metric_id=NEW.metric_id AND metric_version_id=NEW.metric_version_id)
  OR NEW.metric_key ~ '^invariant_[1-8]$' OR NEW.source_snapshot_json->>'id' IS DISTINCT FROM u.unit_id::text
  OR NEW.source_snapshot_json->>'entity' IS DISTINCT FROM u.unit_type
  OR NEW.source_snapshot_json->>'createdAt' IS DISTINCT FROM u.source_snapshot_json->>'createdAt' THEN
   RAISE EXCEPTION 'experiment_exact_native_outcome_required' USING ERRCODE='23514'; END IF;
 IF u.unit_type='issue' THEN
  SELECT * INTO i FROM issues WHERE company_id=NEW.company_id AND id=u.unit_id AND hidden_at IS NULL;
  IF i.id IS NULL OR NEW.source_snapshot_json->>'status' IS DISTINCT FROM i.status
   OR NEW.source_snapshot_json->>'projectId' IS DISTINCT FROM i.project_id::text
   OR (NEW.source_snapshot_json->>'updatedAt')::timestamptz IS DISTINCT FROM date_trunc('milliseconds',i.updated_at) THEN
   RAISE EXCEPTION 'experiment_actual_issue_capture_required' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO p FROM projects WHERE company_id=NEW.company_id AND id=u.unit_id AND archived_at IS NULL;
  IF p.id IS NULL OR NEW.source_snapshot_json->>'status' IS DISTINCT FROM p.status
   OR NEW.source_snapshot_json->>'projectId' IS NOT NULL
   OR (NEW.source_snapshot_json->>'updatedAt')::timestamptz IS DISTINCT FROM date_trunc('milliseconds',p.updated_at) THEN
   RAISE EXCEPTION 'experiment_actual_project_capture_required' USING ERRCODE='23514'; END IF;
 END IF;
 expected_value=CASE WHEN metric.definition_json->'calculation'->'numerator'->'statuses' ? (NEW.source_snapshot_json->>'status') THEN 1 ELSE 0 END;
 IF NEW.value<>expected_value OR NEW.captured_at<(v.definition_json->'sampleOrDurationPlan'->>'until')::timestamptz THEN
  RAISE EXCEPTION 'experiment_registered_binary_outcome_required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
-- Expand each complete capture once and compare every original native receipt.
CREATE OR REPLACE FUNCTION aw_experiment_analysis_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected bigint; actual bigint; declared bigint;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM business_experiment_analyses WHERE id=NEW.id) THEN RETURN NEW; END IF;
 SELECT count(*) INTO declared FROM business_experiment_assignments WHERE company_id=NEW.company_id AND version_id=NEW.version_id;
 IF declared<>jsonb_array_length(NEW.capture_json->'units') OR EXISTS(
  WITH captured AS MATERIALIZED (
   SELECT c->>'unitId' AS unit_id, c->>'assignmentReceiptHash' AS receipt_hash, c->>'arm' AS arm
   FROM jsonb_array_elements(NEW.capture_json->'units') c
  )
  SELECT 1 FROM business_experiment_assignments u
  LEFT JOIN captured c ON c.unit_id=u.unit_id::text AND c.receipt_hash=u.receipt_hash AND c.arm=u.arm
  WHERE u.company_id=NEW.company_id AND u.version_id=NEW.version_id AND c.unit_id IS NULL
 ) THEN RAISE EXCEPTION 'experiment_complete_assignment_capture_required' USING ERRCODE='23514'; END IF;
 IF NEW.capture_json->>'completionReason'='fixed_horizon' THEN
  SELECT declared*count(*) INTO expected FROM business_experiment_metric_pins WHERE company_id=NEW.company_id AND version_id=NEW.version_id AND metric_key !~ '^invariant_[1-8]$';
 ELSE expected=0; END IF;
 SELECT count(*) INTO actual FROM business_experiment_outcomes WHERE company_id=NEW.company_id AND analysis_id=NEW.id;
 IF actual<>expected OR NOT EXISTS(SELECT 1 FROM business_experiment_transitions WHERE company_id=NEW.company_id AND experiment_id=NEW.experiment_id AND version_id=NEW.version_id AND from_state='completed' AND to_state='analyzing' AND created_at=NEW.analyzed_at)
  OR EXISTS(
   WITH captured AS MATERIALIZED (
    SELECT cu->>'unitId' AS unit_id, co->>'outcomeReceiptId' AS outcome_id, co->>'key' AS metric_key,
     co->>'metricId' AS metric_id, co->>'metricVersionId' AS metric_version_id,
     co->>'sourceHash' AS source_hash, (co->>'value')::integer AS value
    FROM jsonb_array_elements(NEW.capture_json->'units') cu,
     LATERAL jsonb_array_elements(cu->'outcomes') co
   )
   SELECT 1 FROM business_experiment_outcomes o
   JOIN business_experiment_assignments u ON u.id=o.assignment_id AND u.company_id=o.company_id
   LEFT JOIN captured c ON c.unit_id=u.unit_id::text AND c.outcome_id=o.id::text AND c.metric_key=o.metric_key
    AND c.metric_id=o.metric_id::text AND c.metric_version_id=o.metric_version_id::text
    AND c.source_hash=o.source_hash AND c.value=o.value
   WHERE o.company_id=NEW.company_id AND o.analysis_id=NEW.id AND c.outcome_id IS NULL
  ) THEN RAISE EXCEPTION 'experiment_complete_final_outcomes_required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
