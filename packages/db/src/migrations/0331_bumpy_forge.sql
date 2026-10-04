CREATE TABLE "agent_execution_authorizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"manifest_id" uuid NOT NULL,
	"context_manifest_refs" jsonb NOT NULL,
	"authority_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_execution_manifest_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"manifest_id" uuid NOT NULL,
	"type" text NOT NULL,
	"ref" text NOT NULL,
	"version_ref" text
);
--> statement-breakpoint
CREATE TABLE "agent_execution_manifests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"agent_identity_id" uuid NOT NULL,
	"context_manifest_id" uuid NOT NULL,
	"manifest" jsonb NOT NULL,
	"policy_snapshot_hash" text NOT NULL,
	"hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_execution_manifests_run_uq" UNIQUE("run_id"),
	CONSTRAINT "agent_execution_manifests_company_id_uq" UNIQUE("company_id","id")
);
--> statement-breakpoint
CREATE TABLE "agent_execution_scope_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"scope" jsonb NOT NULL,
	"issue_id" uuid,
	"query" text NOT NULL,
	"run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "agent_execution_scope_requests_run_uq" UNIQUE("run_id")
);
--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ADD CONSTRAINT "heartbeat_runs_company_agent_id_uq" UNIQUE("company_id","agent_id","id");
--> statement-breakpoint
ALTER TABLE "agent_execution_authorizations" ADD CONSTRAINT "agent_execution_authorizations_company_id_manifest_id_agent_execution_manifests_company_id_id_fk" FOREIGN KEY ("company_id","manifest_id") REFERENCES "public"."agent_execution_manifests"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_execution_manifest_items" ADD CONSTRAINT "agent_execution_manifest_items_company_id_manifest_id_agent_execution_manifests_company_id_id_fk" FOREIGN KEY ("company_id","manifest_id") REFERENCES "public"."agent_execution_manifests"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_execution_manifests" ADD CONSTRAINT "agent_execution_manifests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_execution_manifests" ADD CONSTRAINT "agent_execution_manifests_agent_identity_id_agent_identities_id_fk" FOREIGN KEY ("agent_identity_id") REFERENCES "public"."agent_identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_execution_manifests" ADD CONSTRAINT "agent_execution_manifests_context_manifest_id_context_manifests_id_fk" FOREIGN KEY ("context_manifest_id") REFERENCES "public"."context_manifests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_execution_manifests" ADD CONSTRAINT "agent_execution_manifests_company_id_agent_id_run_id_heartbeat_runs_company_id_agent_id_id_fk" FOREIGN KEY ("company_id","agent_id","run_id") REFERENCES "public"."heartbeat_runs"("company_id","agent_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_execution_manifests" ADD CONSTRAINT "agent_execution_manifests_company_id_agent_id_agent_identity_id_agents_company_id_id_agent_identity_id_fk" FOREIGN KEY ("company_id","agent_id","agent_identity_id") REFERENCES "public"."agents"("company_id","id","agent_identity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_execution_scope_requests" ADD CONSTRAINT "agent_execution_scope_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_execution_scope_requests" ADD CONSTRAINT "agent_execution_scope_requests_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_execution_scope_requests" ADD CONSTRAINT "agent_execution_scope_requests_company_id_agent_id_agents_company_id_id_fk" FOREIGN KEY ("company_id","agent_id") REFERENCES "public"."agents"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_execution_authorizations_manifest_idx" ON "agent_execution_authorizations" USING btree ("company_id","manifest_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_execution_manifest_items_ref_idx" ON "agent_execution_manifest_items" USING btree ("company_id","type","ref");--> statement-breakpoint
CREATE INDEX "agent_execution_manifests_agent_idx" ON "agent_execution_manifests" USING btree ("company_id","agent_id","created_at");--> statement-breakpoint

--> statement-breakpoint
CREATE FUNCTION aw_v5_execution_manifest_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' OR EXISTS (SELECT 1 FROM heartbeat_runs WHERE id = OLD.run_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'aw_v5_execution_manifest_immutable', MESSAGE = 'Execution manifests are immutable';
  END IF;
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v5_execution_manifest_immutable BEFORE UPDATE OR DELETE ON agent_execution_manifests FOR EACH ROW EXECUTE FUNCTION aw_v5_execution_manifest_immutable();
--> statement-breakpoint
CREATE FUNCTION aw_v5_execution_item_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' OR EXISTS (SELECT 1 FROM agent_execution_manifests WHERE id = OLD.manifest_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'aw_v5_execution_manifest_immutable', MESSAGE = 'Execution provenance is immutable';
  END IF;
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v5_execution_items_immutable BEFORE UPDATE OR DELETE ON agent_execution_manifest_items FOR EACH ROW EXECUTE FUNCTION aw_v5_execution_item_immutable();
--> statement-breakpoint
CREATE TRIGGER aw_v5_execution_authorizations_immutable BEFORE UPDATE OR DELETE ON agent_execution_authorizations FOR EACH ROW EXECUTE FUNCTION aw_v5_execution_item_immutable();
