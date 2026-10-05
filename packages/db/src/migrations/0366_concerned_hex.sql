CREATE TABLE "runtime_policy_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"binding_id" uuid NOT NULL,
	"runtime_cell_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"execution_manifest_id" uuid NOT NULL,
	"policy_version" integer NOT NULL,
	"policy_hash" text NOT NULL,
	"capability_snapshot_hash" text,
	"compilation" jsonb NOT NULL,
	"authority_hash" text NOT NULL,
	"source_policy_refs" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sandbox_policy_tenant_uq" UNIQUE("company_id","id"),
	CONSTRAINT "sandbox_policy_binding_version_uq" UNIQUE("company_id","binding_id","policy_version"),
	CONSTRAINT "sandbox_policy_status_check" CHECK ("runtime_policy_snapshots"."status" in ('draft','qualified','superseded','revoked')),
	CONSTRAINT "sandbox_policy_version_check" CHECK ("runtime_policy_snapshots"."policy_version">0)
);
--> statement-breakpoint
CREATE TABLE "runtime_sandbox_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"runtime_cell_id" uuid NOT NULL,
	"cell_generation" text NOT NULL,
	"backend" text NOT NULL,
	"profile" text NOT NULL,
	"sandbox_ref" text,
	"boundary_policy" jsonb NOT NULL,
	"boundary_policy_hash" text NOT NULL,
	"capability_snapshot" jsonb,
	"capability_snapshot_hash" text,
	"qualification_run_id" uuid,
	"status" text DEFAULT 'requested' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sandbox_binding_tenant_uq" UNIQUE("company_id","id"),
	CONSTRAINT "sandbox_binding_cell_generation_uq" UNIQUE("company_id","runtime_cell_id","cell_generation"),
	CONSTRAINT "sandbox_binding_status_check" CHECK ("runtime_sandbox_bindings"."status" in ('requested','ready','degraded','quarantined','stopping','stopped','failed','deleted')),
	CONSTRAINT "sandbox_binding_version_check" CHECK ("runtime_sandbox_bindings"."version">0)
);
--> statement-breakpoint
CREATE TABLE "sandbox_qualification_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"binding_id" uuid NOT NULL,
	"backend" text NOT NULL,
	"backend_version" text NOT NULL,
	"host_or_image_ref" text NOT NULL,
	"kernel_version" text,
	"suite_version" text NOT NULL,
	"evidence_kind" text NOT NULL,
	"status" text NOT NULL,
	"results" jsonb NOT NULL,
	"exceptions" jsonb NOT NULL,
	"report_hash" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sandbox_qualification_tenant_uq" UNIQUE("company_id","id")
);
--> statement-breakpoint
ALTER TABLE "runtime_policy_snapshots" ADD CONSTRAINT "runtime_policy_snapshots_company_id_binding_id_runtime_sandbox_bindings_company_id_id_fk" FOREIGN KEY ("company_id","binding_id") REFERENCES "public"."runtime_sandbox_bindings"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_policy_snapshots" ADD CONSTRAINT "runtime_policy_snapshots_company_id_runtime_cell_id_runtime_cells_company_id_id_fk" FOREIGN KEY ("company_id","runtime_cell_id") REFERENCES "public"."runtime_cells"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_policy_snapshots" ADD CONSTRAINT "runtime_policy_snapshots_company_id_agent_id_agents_company_id_id_fk" FOREIGN KEY ("company_id","agent_id") REFERENCES "public"."agents"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_policy_snapshots" ADD CONSTRAINT "runtime_policy_snapshots_company_id_execution_manifest_id_agent_execution_manifests_company_id_id_fk" FOREIGN KEY ("company_id","execution_manifest_id") REFERENCES "public"."agent_execution_manifests"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_sandbox_bindings" ADD CONSTRAINT "runtime_sandbox_bindings_company_id_runtime_cell_id_runtime_cells_company_id_id_fk" FOREIGN KEY ("company_id","runtime_cell_id") REFERENCES "public"."runtime_cells"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_qualification_runs" ADD CONSTRAINT "sandbox_qualification_runs_company_id_binding_id_runtime_sandbox_bindings_company_id_id_fk" FOREIGN KEY ("company_id","binding_id") REFERENCES "public"."runtime_sandbox_bindings"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sandbox_policy_binding_idx" ON "runtime_policy_snapshots" USING btree ("company_id","binding_id","policy_version");--> statement-breakpoint
CREATE INDEX "sandbox_binding_cell_idx" ON "runtime_sandbox_bindings" USING btree ("company_id","runtime_cell_id");--> statement-breakpoint
CREATE INDEX "sandbox_qualification_binding_idx" ON "sandbox_qualification_runs" USING btree ("company_id","binding_id");--> statement-breakpoint
ALTER TABLE runtime_sandbox_bindings ADD CONSTRAINT sandbox_binding_qualification_fk FOREIGN KEY(company_id,qualification_run_id) REFERENCES sandbox_qualification_runs(company_id,id);
--> statement-breakpoint
CREATE FUNCTION aw_v7_sandbox_binding_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c runtime_cells; q sandbox_qualification_runs;
BEGIN
 SELECT * INTO c FROM runtime_cells WHERE company_id=NEW.company_id AND id=NEW.runtime_cell_id;
 IF TG_OP='INSERT' AND c.status<>'STOPPED' THEN RAISE EXCEPTION 'sandbox_binding_requires_stopped_cell' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (NEW.company_id,NEW.runtime_cell_id,NEW.cell_generation,NEW.backend,NEW.profile,NEW.boundary_policy,NEW.boundary_policy_hash,NEW.created_by_user_id,NEW.created_at) IS DISTINCT FROM (OLD.company_id,OLD.runtime_cell_id,OLD.cell_generation,OLD.backend,OLD.profile,OLD.boundary_policy,OLD.boundary_policy_hash,OLD.created_by_user_id,OLD.created_at) THEN RAISE EXCEPTION 'sandbox_binding_boundary_immutable' USING ERRCODE='23514'; END IF;
 IF NEW.backend NOT IN ('existing_cell_container','openshell') OR NEW.profile NOT IN ('development','compatibility','standard_managed','high_assurance_managed') OR NEW.boundary_policy->>'profile'<>NEW.profile THEN RAISE EXCEPTION 'sandbox_binding_contract_invalid' USING ERRCODE='23514'; END IF;
 IF NEW.status='ready' THEN
  SELECT * INTO q FROM sandbox_qualification_runs WHERE company_id=NEW.company_id AND id=NEW.qualification_run_id AND binding_id=NEW.id;
  IF c.deleted_at IS NOT NULL OR c.generation::text<>NEW.cell_generation OR q.id IS NULL OR q.status<>'passed' OR jsonb_array_length(q.results)<>18 OR EXISTS(SELECT 1 FROM jsonb_array_elements(q.results) r WHERE r->>'verdict'<>'pass' OR coalesce(r->>'observationHash','')!~'^[a-f0-9]{64}$') OR q.evidence_kind<>'protected_host_report' OR q.backend<>NEW.backend OR NEW.capability_snapshot IS NULL OR NEW.capability_snapshot_hash IS NULL OR NEW.capability_snapshot->>'qualificationHash'<>q.report_hash OR NEW.capability_snapshot->>'evidenceKind'<>'protected_host_report' OR NEW.capability_snapshot->>'backendVersion'<>q.backend_version OR NEW.capability_snapshot->>'sandboxImageDigest'<>coalesce(c.active_image_digest,c.desired_image_digest) OR (NEW.capability_snapshot->>'expiresAt')::timestamptz<=now() THEN RAISE EXCEPTION 'sandbox_current_protected_qualification_required' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v7_sandbox_binding_guard BEFORE INSERT OR UPDATE ON runtime_sandbox_bindings FOR EACH ROW EXECUTE FUNCTION aw_v7_sandbox_binding_guard();
--> statement-breakpoint
CREATE FUNCTION aw_v7_sandbox_qualification_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'sandbox_qualification_report_immutable' USING ERRCODE='23514'; END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v7_sandbox_qualification_immutable BEFORE UPDATE OR DELETE ON sandbox_qualification_runs FOR EACH ROW EXECUTE FUNCTION aw_v7_sandbox_qualification_immutable();
--> statement-breakpoint
CREATE FUNCTION aw_v7_sandbox_policy_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b runtime_sandbox_bindings; c runtime_cells; m agent_execution_manifests;
BEGIN
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') THEN RAISE EXCEPTION 'sandbox_policy_snapshot_immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND OLD.status IN ('superseded','revoked') AND NEW.status<>OLD.status THEN RAISE EXCEPTION 'sandbox_policy_cannot_revive' USING ERRCODE='23514'; END IF;
 SELECT * INTO b FROM runtime_sandbox_bindings WHERE company_id=NEW.company_id AND id=NEW.binding_id;
 SELECT * INTO c FROM runtime_cells WHERE company_id=NEW.company_id AND id=NEW.runtime_cell_id;
 SELECT * INTO m FROM agent_execution_manifests WHERE company_id=NEW.company_id AND id=NEW.execution_manifest_id;
 IF b.runtime_cell_id<>NEW.runtime_cell_id OR m.agent_id<>NEW.agent_id THEN RAISE EXCEPTION 'sandbox_policy_source_scope_mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.status='qualified' THEN
  IF b.status<>'ready' OR b.cell_generation<>c.generation::text OR c.deleted_at IS NOT NULL OR NEW.expires_at<=now() OR NEW.compilation->>'proverResult'<>'pass' OR NEW.compilation->'compiledPolicy'->>'riskClass'='C4' OR NEW.capability_snapshot_hash IS DISTINCT FROM b.capability_snapshot_hash OR (b.capability_snapshot->>'expiresAt')::timestamptz<=now() OR NOT EXISTS(SELECT 1 FROM instance_settings WHERE singleton_key='default' AND experimental->>'sandbox_abstraction_v7'='true') OR NOT EXISTS(SELECT 1 FROM heartbeat_runs r JOIN issues i ON i.company_id=r.company_id AND i.id=r.native_issue_id WHERE r.company_id=m.company_id AND r.id=m.run_id AND r.agent_id=m.agent_id AND r.status='running' AND i.assignee_agent_id=m.agent_id AND i.hidden_at IS NULL AND r.responsible_user_id=m.manifest->>'responsibleUserId') THEN RAISE EXCEPTION 'sandbox_policy_current_execution_required' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v7_sandbox_policy_guard BEFORE INSERT OR UPDATE ON runtime_policy_snapshots FOR EACH ROW EXECUTE FUNCTION aw_v7_sandbox_policy_guard();
--> statement-breakpoint
CREATE FUNCTION aw_v7_sandbox_cell_invalidate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.generation,NEW.active_image_digest,NEW.desired_image_digest,NEW.model_provider,NEW.model_secret_ref,NEW.model_secret_version,NEW.provider_binding_id,NEW.deleted_at) IS DISTINCT FROM (OLD.generation,OLD.active_image_digest,OLD.desired_image_digest,OLD.model_provider,OLD.model_secret_ref,OLD.model_secret_version,OLD.provider_binding_id,OLD.deleted_at) THEN
  UPDATE runtime_sandbox_bindings SET status='quarantined',version=version+1,updated_at=now() WHERE company_id=NEW.company_id AND runtime_cell_id=NEW.id AND status NOT IN ('deleted','quarantined');
  UPDATE runtime_policy_snapshots SET status='revoked' WHERE company_id=NEW.company_id AND runtime_cell_id=NEW.id AND status IN ('draft','qualified');
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v7_sandbox_cell_invalidate AFTER UPDATE ON runtime_cells FOR EACH ROW EXECUTE FUNCTION aw_v7_sandbox_cell_invalidate();
--> statement-breakpoint
CREATE FUNCTION aw_v7_sandbox_native_admission_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.operation_type IN ('start','upgrade','restore','migrate') AND EXISTS(SELECT 1 FROM runtime_sandbox_bindings b WHERE b.company_id=NEW.company_id AND b.runtime_cell_id=NEW.runtime_cell_id) THEN RAISE EXCEPTION 'sandbox_applied_boundary_admission_required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v7_sandbox_native_admission_guard BEFORE INSERT ON runtime_operations FOR EACH ROW EXECUTE FUNCTION aw_v7_sandbox_native_admission_guard();
