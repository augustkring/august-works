-- Validate the complete inserted population with the original Source rules.
-- Statement transition tables contain actual inserted rows, never caller claims.
-- Existing immutable UPDATE/DELETE and cascading C7 guards remain in place.
CREATE FUNCTION aw_analytical_edges_admission() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tenant uuid;
BEGIN
 FOR tenant IN SELECT DISTINCT company_id FROM inserted_edges ORDER BY company_id LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('business-events:' || tenant::text, 0));
 END LOOP;
 IF EXISTS(
  SELECT 1 FROM inserted_edges e JOIN analytical_source_suppressions s
   ON s.company_id=e.company_id AND s.input_type=e.input_type AND s.input_ref=e.input_ref
 ) THEN RAISE EXCEPTION 'Analytical source was erased' USING ERRCODE='23514'; END IF;
 IF EXISTS(
  WITH sources AS MATERIALIZED (SELECT DISTINCT company_id,input_type,input_ref,input_hash FROM inserted_edges)
  SELECT 1 FROM sources e WHERE NOT (CASE e.input_type
   WHEN 'issue' THEN EXISTS(SELECT 1 FROM issues WHERE company_id=e.company_id AND id=e.input_ref)
   WHEN 'goal' THEN EXISTS(SELECT 1 FROM goals WHERE company_id=e.company_id AND id=e.input_ref)
   WHEN 'project' THEN EXISTS(SELECT 1 FROM projects WHERE company_id=e.company_id AND id=e.input_ref)
   WHEN 'metric_version' THEN EXISTS(SELECT 1 FROM business_metric_versions WHERE company_id=e.company_id AND id=e.input_ref)
   WHEN 'business_event_source' THEN EXISTS(SELECT 1 FROM business_events b JOIN activity_log a ON a.company_id=b.company_id AND a.id=b.source_ref
    WHERE b.company_id=e.company_id AND b.source_ref=e.input_ref AND b.source_hash=e.input_hash
     AND b.tombstoned_at IS NULL AND b.expires_at>now() AND b.source_version='aw-activity-v2'
     AND NOT EXISTS(SELECT 1 FROM business_event_suppressions s WHERE s.company_id=b.company_id AND s.source_ref=b.source_ref))
   WHEN 'governance_obligation' THEN EXISTS(SELECT 1 FROM governance_obligations WHERE company_id=e.company_id AND id=e.input_ref)
   ELSE false END)
 ) THEN RAISE EXCEPTION 'Analytical source is unavailable in this company' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
DROP TRIGGER aw_analytical_edge_admission ON analytical_lineage_edges;
--> statement-breakpoint
CREATE TRIGGER aw_analytical_edges_admission AFTER INSERT ON analytical_lineage_edges
REFERENCING NEW TABLE AS inserted_edges FOR EACH STATEMENT EXECUTE FUNCTION aw_analytical_edges_admission();
--> statement-breakpoint
CREATE FUNCTION aw_experiment_outcomes_admission() RETURNS trigger LANGUAGE plpgsql AS $$

BEGIN
 IF EXISTS(
  SELECT 1 FROM inserted_outcomes n
  LEFT JOIN business_experiment_analyses a ON a.company_id=n.company_id AND a.experiment_id=n.experiment_id AND a.version_id=n.version_id AND a.id=n.analysis_id
  LEFT JOIN business_experiment_assignments u ON u.company_id=n.company_id AND u.experiment_id=n.experiment_id AND u.version_id=n.version_id AND u.id=n.assignment_id
  WHERE a.id IS NULL OR u.id IS NULL OR n.captured_at IS DISTINCT FROM a.analyzed_at OR n.metric_key ~ '^invariant_[1-8]$'
   OR n.source_snapshot_json->>'id' IS DISTINCT FROM u.unit_id::text
   OR n.source_snapshot_json->>'entity' IS DISTINCT FROM u.unit_type
   OR n.source_snapshot_json->>'createdAt' IS DISTINCT FROM u.source_snapshot_json->>'createdAt'
 ) OR EXISTS(
  SELECT 1 FROM (SELECT DISTINCT company_id,experiment_id,version_id FROM inserted_outcomes) n
  LEFT JOIN business_experiment_versions v ON v.company_id=n.company_id AND v.experiment_id=n.experiment_id AND v.id=n.version_id
  LEFT JOIN business_experiment_completions c ON c.company_id=n.company_id AND c.experiment_id=n.experiment_id AND c.version_id=n.version_id AND c.reason='fixed_horizon'
  LEFT JOIN business_experiments r ON r.company_id=n.company_id AND r.id=n.experiment_id AND r.current_version_id=n.version_id AND r.state='analyzing'
  WHERE v.id IS NULL OR c.id IS NULL OR r.id IS NULL
 ) OR EXISTS(
  SELECT 1 FROM (SELECT DISTINCT company_id,version_id,metric_key,metric_id,metric_version_id FROM inserted_outcomes) n
  LEFT JOIN business_metric_versions m ON m.company_id=n.company_id AND m.metric_id=n.metric_id AND m.id=n.metric_version_id
  LEFT JOIN business_experiment_metric_pins p ON p.company_id=n.company_id AND p.version_id=n.version_id AND p.metric_key=n.metric_key AND p.metric_id=n.metric_id AND p.metric_version_id=n.metric_version_id
  WHERE m.id IS NULL OR p.metric_key IS NULL
 ) THEN RAISE EXCEPTION 'experiment_exact_native_outcome_required' USING ERRCODE='23514'; END IF;
 -- Compact outcome manifests inherit the existing same-company assignment
 -- lineage through the mandatory cascading assignment FK. Bind its exact
 -- manifest and immutable lineage hash; legacy fully copied manifests remain valid.
 IF EXISTS(
  SELECT 1 FROM inserted_outcomes n
  JOIN business_experiment_assignments u ON u.company_id=n.company_id AND u.id=n.assignment_id
  JOIN analytical_lineage_manifests m ON m.company_id=n.company_id AND m.id=n.lineage_manifest_id
  JOIN analytical_lineage_manifests inherited ON inherited.company_id=u.company_id AND inherited.id=u.lineage_manifest_id
  WHERE m.parameters_json ? 'assignmentManifestId' AND (
   m.parameters_json->>'assignmentManifestId' IS DISTINCT FROM u.lineage_manifest_id::text
   OR m.parameters_json->>'assignmentLineageHash' IS DISTINCT FROM inherited.parameters_json->>'lineageHash'
  )
 ) THEN RAISE EXCEPTION 'experiment_inherited_assignment_lineage_required' USING ERRCODE='23514'; END IF;
 IF EXISTS(
  SELECT 1 FROM inserted_outcomes n JOIN business_experiment_assignments u ON u.company_id=n.company_id AND u.id=n.assignment_id
  LEFT JOIN LATERAL (SELECT id,status,project_id,updated_at FROM issues WHERE company_id=n.company_id AND id=u.unit_id AND hidden_at IS NULL LIMIT 1) i ON true
  WHERE u.unit_type='issue' AND (i.id IS NULL OR n.source_snapshot_json->>'status' IS DISTINCT FROM i.status
   OR n.source_snapshot_json->>'projectId' IS DISTINCT FROM i.project_id::text
   OR (n.source_snapshot_json->>'updatedAt')::timestamptz IS DISTINCT FROM date_trunc('milliseconds',i.updated_at))
 ) THEN RAISE EXCEPTION 'experiment_actual_issue_capture_required' USING ERRCODE='23514'; END IF;
 IF EXISTS(
  SELECT 1 FROM inserted_outcomes n JOIN business_experiment_assignments u ON u.company_id=n.company_id AND u.id=n.assignment_id
  LEFT JOIN LATERAL (SELECT id,status,updated_at FROM projects WHERE company_id=n.company_id AND id=u.unit_id AND archived_at IS NULL LIMIT 1) p ON true
  WHERE u.unit_type='project' AND (p.id IS NULL OR n.source_snapshot_json->>'status' IS DISTINCT FROM p.status
   OR n.source_snapshot_json->>'projectId' IS NOT NULL
   OR (n.source_snapshot_json->>'updatedAt')::timestamptz IS DISTINCT FROM date_trunc('milliseconds',p.updated_at))
 ) THEN RAISE EXCEPTION 'experiment_actual_project_capture_required' USING ERRCODE='23514'; END IF;
 IF EXISTS(
  WITH versions AS MATERIALIZED (
   SELECT v.company_id,v.id,(v.definition_json->'sampleOrDurationPlan'->>'until')::timestamptz AS until
   FROM business_experiment_versions v JOIN (SELECT DISTINCT company_id,version_id FROM inserted_outcomes) n ON n.company_id=v.company_id AND n.version_id=v.id
  ), metrics AS MATERIALIZED (
   SELECT v.company_id,v.id,v.definition_json->'calculation'->'numerator'->'statuses' AS statuses
   FROM business_metric_versions v JOIN (SELECT DISTINCT company_id,metric_version_id FROM inserted_outcomes) n ON n.company_id=v.company_id AND n.metric_version_id=v.id
  )
  SELECT 1 FROM inserted_outcomes n JOIN versions v ON v.company_id=n.company_id AND v.id=n.version_id
  JOIN metrics m ON m.company_id=n.company_id AND m.id=n.metric_version_id
  WHERE n.value<>CASE WHEN m.statuses ? (n.source_snapshot_json->>'status') THEN 1 ELSE 0 END OR n.captured_at<v.until
 ) THEN RAISE EXCEPTION 'experiment_registered_binary_outcome_required' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
DROP TRIGGER aw_experiment_outcome_guard ON business_experiment_outcomes;
--> statement-breakpoint
CREATE TRIGGER aw_experiment_outcome_guard BEFORE UPDATE OR DELETE ON business_experiment_outcomes
FOR EACH ROW EXECUTE FUNCTION aw_experiment_outcome_guard();
--> statement-breakpoint
CREATE TRIGGER aw_experiment_outcomes_admission AFTER INSERT ON business_experiment_outcomes
REFERENCING NEW TABLE AS inserted_outcomes FOR EACH STATEMENT EXECUTE FUNCTION aw_experiment_outcomes_admission();
