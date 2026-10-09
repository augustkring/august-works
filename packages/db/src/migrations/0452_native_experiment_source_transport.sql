-- Transport repeated native checks through their original statement owner.
-- DISTINCT includes every actual input to each check, including the complete
-- source snapshot: one forged variant remains a distinct input and is rejected.
-- Every inserted outcome still checks exact identity, tenant, manifest, lineage
-- and pin ownership above. No row, outcome, signature or Source is omitted.
-- Keep the original 8-second SQL and 30-second operation admission budgets.
CREATE OR REPLACE FUNCTION aw_experiment_outcomes_admission() RETURNS trigger LANGUAGE plpgsql AS $$

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
  -- Native tenant/id constraints already make these exact point lookups.
  -- Bound each lookup explicitly so an un-analyzed growing receipt table
  -- cannot become a full-table scan for each later inserted statement.
  JOIN LATERAL (SELECT parameters_json FROM analytical_lineage_manifests
   WHERE company_id=n.company_id AND id=n.lineage_manifest_id LIMIT 1) m ON true
  JOIN LATERAL (SELECT parameters_json FROM analytical_lineage_manifests
   WHERE company_id=u.company_id AND id=u.lineage_manifest_id LIMIT 1) inherited ON true
  WHERE m.parameters_json ? 'assignmentManifestId' AND (
   m.parameters_json->>'assignmentManifestId' IS DISTINCT FROM u.lineage_manifest_id::text
   OR m.parameters_json->>'assignmentLineageHash' IS DISTINCT FROM inherited.parameters_json->>'lineageHash'
  )
 ) THEN RAISE EXCEPTION 'experiment_inherited_assignment_lineage_required' USING ERRCODE='23514'; END IF;
 IF EXISTS(
  WITH source_inputs AS MATERIALIZED (
   SELECT DISTINCT company_id,assignment_id,source_snapshot_json FROM inserted_outcomes
  )
  SELECT 1 FROM source_inputs n JOIN business_experiment_assignments u ON u.company_id=n.company_id AND u.id=n.assignment_id
  LEFT JOIN LATERAL (SELECT id,status,project_id,updated_at FROM issues WHERE company_id=n.company_id AND id=u.unit_id AND hidden_at IS NULL LIMIT 1) i ON true
  WHERE u.unit_type='issue' AND (i.id IS NULL OR n.source_snapshot_json->>'status' IS DISTINCT FROM i.status
   OR n.source_snapshot_json->>'projectId' IS DISTINCT FROM i.project_id::text
   OR (n.source_snapshot_json->>'updatedAt')::timestamptz IS DISTINCT FROM date_trunc('milliseconds',i.updated_at))
 ) THEN RAISE EXCEPTION 'experiment_actual_issue_capture_required' USING ERRCODE='23514'; END IF;
 IF EXISTS(
  WITH source_inputs AS MATERIALIZED (
   SELECT DISTINCT company_id,assignment_id,source_snapshot_json FROM inserted_outcomes
  )
  SELECT 1 FROM source_inputs n JOIN business_experiment_assignments u ON u.company_id=n.company_id AND u.id=n.assignment_id
  LEFT JOIN LATERAL (SELECT id,status,updated_at FROM projects WHERE company_id=n.company_id AND id=u.unit_id AND archived_at IS NULL LIMIT 1) p ON true
  WHERE u.unit_type='project' AND (p.id IS NULL OR n.source_snapshot_json->>'status' IS DISTINCT FROM p.status
   OR n.source_snapshot_json->>'projectId' IS NOT NULL
   OR (n.source_snapshot_json->>'updatedAt')::timestamptz IS DISTINCT FROM date_trunc('milliseconds',p.updated_at))
 ) THEN RAISE EXCEPTION 'experiment_actual_project_capture_required' USING ERRCODE='23514'; END IF;
 IF EXISTS(
  WITH metric_inputs AS MATERIALIZED (
   SELECT DISTINCT company_id,version_id,metric_version_id,value,captured_at,
    source_snapshot_json->>'status' AS source_status FROM inserted_outcomes
  ), versions AS MATERIALIZED (
   SELECT v.company_id,v.id,(v.definition_json->'sampleOrDurationPlan'->>'until')::timestamptz AS until
   FROM business_experiment_versions v JOIN (SELECT DISTINCT company_id,version_id FROM metric_inputs) n ON n.company_id=v.company_id AND n.version_id=v.id
  ), metrics AS MATERIALIZED (
   SELECT v.company_id,v.id,v.definition_json->'calculation'->'numerator'->'statuses' AS statuses
   FROM business_metric_versions v JOIN (SELECT DISTINCT company_id,metric_version_id FROM metric_inputs) n ON n.company_id=v.company_id AND n.metric_version_id=v.id
  )
  SELECT 1 FROM metric_inputs n JOIN versions v ON v.company_id=n.company_id AND v.id=n.version_id
  JOIN metrics m ON m.company_id=n.company_id AND m.id=n.metric_version_id
  WHERE n.value<>CASE WHEN m.statuses ? n.source_status THEN 1 ELSE 0 END OR n.captured_at<v.until
 ) THEN RAISE EXCEPTION 'experiment_registered_binary_outcome_required' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
-- The original Memory restore fence checks the complete inserted population
-- in one native statement. Keep the canonical marker and rejection unchanged;
-- a single erased input rolls back the entire insert, including valid siblings.
CREATE FUNCTION aw_analytical_restored_manifests_denied_population() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(
  SELECT 1 FROM inserted_manifests n JOIN memory_deletion_markers d
   ON d.company_id=n.company_id AND d.kind='source'
   AND d.key=encode(sha256(convert_to(format('["%s","source",["august_works_analytical","manifest://%s"]]',n.company_id,n.id),'UTF8')),'hex')
 ) THEN
  RAISE EXCEPTION 'Original analytical source was erased' USING ERRCODE='23514',CONSTRAINT='aw_analytical_source_erased';
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE FUNCTION aw_analytical_restored_inputs_denied_population() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(
  SELECT 1 FROM (SELECT DISTINCT company_id,input_type,input_ref FROM inserted_edges) n
  JOIN memory_deletion_markers d ON d.company_id=n.company_id AND d.kind='source'
   AND d.key=encode(sha256(convert_to(format('["%s","source",["august_works_analytical_input","%s://%s"]]',n.company_id,n.input_type,n.input_ref),'UTF8')),'hex')
 ) THEN
  RAISE EXCEPTION 'Original analytical source was erased' USING ERRCODE='23514',CONSTRAINT='aw_analytical_source_erased';
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
DROP TRIGGER analytical_restored_manifest_denied ON analytical_lineage_manifests;
--> statement-breakpoint
CREATE TRIGGER analytical_restored_manifest_denied AFTER INSERT ON analytical_lineage_manifests
 REFERENCING NEW TABLE AS inserted_manifests FOR EACH STATEMENT
 EXECUTE FUNCTION aw_analytical_restored_manifests_denied_population();
--> statement-breakpoint
DROP TRIGGER analytical_restored_input_denied ON analytical_lineage_edges;
--> statement-breakpoint
CREATE TRIGGER analytical_restored_input_denied AFTER INSERT ON analytical_lineage_edges
 REFERENCING NEW TABLE AS inserted_edges FOR EACH STATEMENT
 EXECUTE FUNCTION aw_analytical_restored_inputs_denied_population();
