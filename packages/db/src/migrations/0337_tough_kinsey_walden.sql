ALTER TABLE "company_skill_test_runs" ADD CONSTRAINT "company_skill_test_runs_company_id_uq" UNIQUE("company_id","id");
--> statement-breakpoint
ALTER TABLE "agent_execution_scope_requests" DROP CONSTRAINT "agent_execution_scope_requests_run_id_heartbeat_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "company_skill_eval_scores" DROP CONSTRAINT "company_skill_eval_scores_test_run_id_company_skill_test_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "company_skill_usage_events" DROP CONSTRAINT "company_skill_usage_events_run_id_heartbeat_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "company_skill_versions" ADD CONSTRAINT "company_skill_versions_source_playbook_revision_fk" FOREIGN KEY ("company_id","source_playbook_revision_id") REFERENCES "public"."document_revisions"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_execution_scope_requests" ADD CONSTRAINT "agent_execution_scope_requests_company_agent_run_fk" FOREIGN KEY ("company_id","agent_id","run_id") REFERENCES "public"."heartbeat_runs"("company_id","agent_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_skill_eval_scores" ADD CONSTRAINT "company_skill_eval_scores_company_trace_fk" FOREIGN KEY ("company_id","test_run_id") REFERENCES "public"."company_skill_test_runs"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_skill_usage_events" ADD CONSTRAINT "company_skill_usage_events_company_agent_run_fk" FOREIGN KEY ("company_id","agent_id","run_id") REFERENCES "public"."heartbeat_runs"("company_id","agent_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_execution_manifest_items_pin_uq" ON "agent_execution_manifest_items" USING btree ("manifest_id","type","ref",coalesce("version_ref", ''));--> statement-breakpoint

--> statement-breakpoint
CREATE FUNCTION aw_v5_manifest_item_declared() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pinned jsonb;
BEGIN
  SELECT manifest INTO pinned FROM agent_execution_manifests WHERE id = NEW.manifest_id AND company_id = NEW.company_id;
  IF pinned IS NULL OR NOT (
    NEW.type = 'skill' AND EXISTS (SELECT 1 FROM jsonb_array_elements(pinned->'skills') pin WHERE pin->>'skillId' = NEW.ref AND pin->>'versionId' IS NOT DISTINCT FROM NEW.version_ref)
    OR NEW.type = 'playbook' AND EXISTS (SELECT 1 FROM jsonb_array_elements(pinned->'playbooks') pin WHERE pin->>'playbookId' = NEW.ref AND pin->>'revisionId' IS NOT DISTINCT FROM NEW.version_ref)
    OR NEW.type = 'capability' AND EXISTS (SELECT 1 FROM jsonb_array_elements(pinned->'capabilities') pin WHERE pin->>'ref' = NEW.ref AND pin->>'versionHash' IS NOT DISTINCT FROM NEW.version_ref)
    OR NEW.type = 'company_scope' AND EXISTS (SELECT 1 FROM jsonb_array_elements(pinned->'contextManifests') pin WHERE pin->>'companyId' = NEW.ref AND pin->>'contextManifestId' IS NOT DISTINCT FROM NEW.version_ref)
  ) THEN RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'aw_v5_execution_manifest_immutable', MESSAGE = 'Manifest evidence must match an immutable declared pin'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v5_manifest_item_declared BEFORE INSERT ON agent_execution_manifest_items FOR EACH ROW EXECUTE FUNCTION aw_v5_manifest_item_declared();
