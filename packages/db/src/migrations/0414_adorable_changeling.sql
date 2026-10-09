ALTER TABLE "analytical_context_roots" DROP CONSTRAINT "analytical_context_roots_validity";--> statement-breakpoint
ALTER TABLE "analytical_context_roots" ADD COLUMN "authority_pins" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "analytical_context_roots" ADD CONSTRAINT "analytical_context_roots_validity" CHECK ("analytical_context_roots"."source_count" between 1 and 26200 and "analytical_context_roots"."content_hash" ~ '^[0-9a-f]{64}$' and "analytical_context_roots"."deletion_key" ~ '^[0-9a-f]{64}$' and "analytical_context_roots"."expires_at">"analytical_context_roots"."created_at");
--> statement-breakpoint
-- Reuse the content-free C7 source ledger. UUIDs and the fixed scheme produce
-- exactly the JSON encoding used by memoryDeletionKey, without retaining facts.
CREATE FUNCTION aw_analytical_manifest_source_deleted(tenant uuid, source uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE dependency analytical_context_dependencies%ROWTYPE;
BEGIN
 IF source IS NULL OR NOT EXISTS(SELECT 1 FROM companies WHERE id=tenant) THEN RETURN; END IF;
 INSERT INTO memory_deletion_markers(company_id,key,kind,deleted_at)
 VALUES(tenant,encode(sha256(convert_to(format('["%s","source",["august_works_analytical","manifest://%s"]]',tenant,source),'UTF8')),'hex'),'source',clock_timestamp()) ON CONFLICT DO NOTHING;
 FOR dependency IN SELECT * FROM analytical_context_dependencies WHERE company_id=tenant AND source_manifest_id=source LOOP
  INSERT INTO memory_deletion_markers(company_id,key,kind,record_id,deleted_at)
   SELECT company_id,deletion_key,'record',memory_record_id,clock_timestamp() FROM analytical_context_roots WHERE company_id=tenant AND memory_record_id=dependency.memory_record_id ON CONFLICT DO NOTHING;
  UPDATE memory_records SET content='',title=NULL,summary=NULL,subject_type=NULL,subject_id=NULL,metadata='{}',deleted_at=coalesce(deleted_at,clock_timestamp()),updated_at=clock_timestamp(),retention_state='expired',review_state='rejected'
   WHERE company_id=tenant AND id=dependency.memory_record_id;
 END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION aw_analytical_owner_context_erased() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source uuid;
BEGIN
 source=case when TG_TABLE_NAME='analytical_lineage_manifests' then (to_jsonb(OLD)->>'id')::uuid else coalesce(to_jsonb(OLD)->>'lineage_manifest_id',to_jsonb(OLD)->>'planning_manifest_id')::uuid end;
 PERFORM aw_analytical_manifest_source_deleted(OLD.company_id,source);
 RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER analytical_manifest_source_deleted AFTER DELETE ON analytical_lineage_manifests FOR EACH ROW EXECUTE FUNCTION aw_analytical_owner_context_erased();

--> statement-breakpoint
CREATE TRIGGER business_metric_observations_context_erased AFTER DELETE ON business_metric_observations FOR EACH ROW EXECUTE FUNCTION aw_analytical_owner_context_erased();

--> statement-breakpoint
CREATE TRIGGER process_analysis_runs_context_erased AFTER DELETE ON process_analysis_runs FOR EACH ROW EXECUTE FUNCTION aw_analytical_owner_context_erased();

--> statement-breakpoint
CREATE TRIGGER forecast_spec_versions_context_erased AFTER DELETE ON forecast_spec_versions FOR EACH ROW EXECUTE FUNCTION aw_analytical_owner_context_erased();

--> statement-breakpoint
CREATE TRIGGER forecast_backtests_context_erased AFTER DELETE ON forecast_backtests FOR EACH ROW EXECUTE FUNCTION aw_analytical_owner_context_erased();

--> statement-breakpoint
CREATE TRIGGER forecast_runs_context_erased AFTER DELETE ON forecast_runs FOR EACH ROW EXECUTE FUNCTION aw_analytical_owner_context_erased();

--> statement-breakpoint
CREATE TRIGGER business_scenario_versions_context_erased AFTER DELETE ON business_scenario_versions FOR EACH ROW EXECUTE FUNCTION aw_analytical_owner_context_erased();

--> statement-breakpoint
CREATE TRIGGER business_scenario_runs_context_erased AFTER DELETE ON business_scenario_runs FOR EACH ROW EXECUTE FUNCTION aw_analytical_owner_context_erased();

--> statement-breakpoint
CREATE TRIGGER business_experiment_versions_context_erased AFTER DELETE ON business_experiment_versions FOR EACH ROW EXECUTE FUNCTION aw_analytical_owner_context_erased();

--> statement-breakpoint
CREATE TRIGGER business_experiment_assignments_context_erased AFTER DELETE ON business_experiment_assignments FOR EACH ROW EXECUTE FUNCTION aw_analytical_owner_context_erased();

--> statement-breakpoint
CREATE TRIGGER business_experiment_outcomes_context_erased AFTER DELETE ON business_experiment_outcomes FOR EACH ROW EXECUTE FUNCTION aw_analytical_owner_context_erased();

--> statement-breakpoint
CREATE TRIGGER causal_claim_versions_context_erased AFTER DELETE ON causal_claim_versions FOR EACH ROW EXECUTE FUNCTION aw_analytical_owner_context_erased();

--> statement-breakpoint
CREATE TRIGGER decision_context_versions_context_erased AFTER DELETE ON decision_context_versions FOR EACH ROW EXECUTE FUNCTION aw_analytical_owner_context_erased();

--> statement-breakpoint
CREATE TRIGGER decision_outcome_review_receipts_context_erased AFTER DELETE ON decision_outcome_review_receipts FOR EACH ROW EXECUTE FUNCTION aw_analytical_owner_context_erased();

--> statement-breakpoint
CREATE TRIGGER management_review_snapshots_context_erased AFTER DELETE ON management_review_snapshots FOR EACH ROW EXECUTE FUNCTION aw_analytical_owner_context_erased();

--> statement-breakpoint
CREATE TRIGGER project_roadmap_proposals_context_erased AFTER DELETE ON project_roadmap_proposals FOR EACH ROW EXECUTE FUNCTION aw_analytical_owner_context_erased();
