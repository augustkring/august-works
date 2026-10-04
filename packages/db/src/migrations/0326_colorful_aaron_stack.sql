CREATE TABLE "agent_role_pack_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" uuid NOT NULL,
	"role_pack_id" uuid NOT NULL,
	"version_policy" text DEFAULT 'follow_published' NOT NULL,
	"pinned_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_role_pack_assignments_scope_uq" UNIQUE("company_id","scope_type","scope_id"),
	CONSTRAINT "agent_role_pack_assignments_scope_check" CHECK ("agent_role_pack_assignments"."scope_type" in ('company', 'org_unit', 'agent')),
	CONSTRAINT "agent_role_pack_assignments_policy_check" CHECK (("agent_role_pack_assignments"."version_policy" = 'follow_published' and "agent_role_pack_assignments"."pinned_version_id" is null) or ("agent_role_pack_assignments"."version_policy" = 'pinned' and "agent_role_pack_assignments"."pinned_version_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "role_pack_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"item" jsonb NOT NULL,
	CONSTRAINT "role_pack_items_version_ordinal_uq" UNIQUE("version_id","ordinal")
);
--> statement-breakpoint
CREATE TABLE "role_pack_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"role_pack_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "role_pack_versions_revision_uq" UNIQUE("role_pack_id","revision_number"),
	CONSTRAINT "role_pack_versions_company_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "role_pack_versions_state_check" CHECK ("role_pack_versions"."state" in ('draft', 'published'))
);
--> statement-breakpoint
CREATE TABLE "role_packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"published_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_packs_company_key_uq" UNIQUE("company_id","key"),
	CONSTRAINT "role_packs_company_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "role_packs_status_check" CHECK ("role_packs"."status" in ('active', 'archived'))
);
--> statement-breakpoint
ALTER TABLE "agent_presence_runtime_bindings" DROP CONSTRAINT "agent_presence_runtime_bindings_company_id_companies_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_presence_runtime_bindings" DROP CONSTRAINT "agent_presence_runtime_bindings_agent_identity_id_provider_binding_id_agent_provider_bindings_agent_identity_id_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_provider_bindings" DROP CONSTRAINT "agent_provider_bindings_agent_identity_id_agent_identities_id_fk";
--> statement-breakpoint
ALTER TABLE "provider_shared_runtime_acknowledgements" DROP CONSTRAINT "provider_shared_runtime_acknowledgements_company_id_companies_id_fk";
--> statement-breakpoint
ALTER TABLE "provider_shared_runtime_acknowledgements" DROP CONSTRAINT "provider_shared_runtime_acknowledgements_provider_binding_id_agent_provider_bindings_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_presence_runtime_bindings" ADD COLUMN "qualified_configuration_hash" text;--> statement-breakpoint
ALTER TABLE "agent_presence_runtime_bindings" ADD COLUMN "conformance_snapshot_hash" text;--> statement-breakpoint
ALTER TABLE "agent_presence_runtime_bindings" ADD COLUMN "conformance_report" jsonb;--> statement-breakpoint
ALTER TABLE "agent_role_pack_assignments" ADD CONSTRAINT "agent_role_pack_assignments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_role_pack_assignments" ADD CONSTRAINT "agent_role_pack_assignments_company_id_role_pack_id_role_packs_company_id_id_fk" FOREIGN KEY ("company_id","role_pack_id") REFERENCES "public"."role_packs"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_role_pack_assignments" ADD CONSTRAINT "agent_role_pack_assignments_company_id_pinned_version_id_role_pack_versions_company_id_id_fk" FOREIGN KEY ("company_id","pinned_version_id") REFERENCES "public"."role_pack_versions"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_pack_items" ADD CONSTRAINT "role_pack_items_company_id_version_id_role_pack_versions_company_id_id_fk" FOREIGN KEY ("company_id","version_id") REFERENCES "public"."role_pack_versions"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_pack_versions" ADD CONSTRAINT "role_pack_versions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_pack_versions" ADD CONSTRAINT "role_pack_versions_company_id_role_pack_id_role_packs_company_id_id_fk" FOREIGN KEY ("company_id","role_pack_id") REFERENCES "public"."role_packs"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_packs" ADD CONSTRAINT "role_packs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_packs" ADD CONSTRAINT "role_packs_published_version_id_role_pack_versions_id_fk" FOREIGN KEY ("published_version_id") REFERENCES "public"."role_pack_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_role_pack_assignments_company_idx" ON "agent_role_pack_assignments" USING btree ("company_id");--> statement-breakpoint
ALTER TABLE "agent_presence_runtime_bindings" ADD CONSTRAINT "agent_presence_runtime_bindings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_presence_runtime_bindings" ADD CONSTRAINT "agent_presence_runtime_bindings_agent_identity_id_provider_binding_id_agent_provider_bindings_agent_identity_id_id_fk" FOREIGN KEY ("agent_identity_id","provider_binding_id") REFERENCES "public"."agent_provider_bindings"("agent_identity_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_provider_bindings" ADD CONSTRAINT "agent_provider_bindings_agent_identity_id_agent_identities_id_fk" FOREIGN KEY ("agent_identity_id") REFERENCES "public"."agent_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_shared_runtime_acknowledgements" ADD CONSTRAINT "provider_shared_runtime_acknowledgements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_shared_runtime_acknowledgements" ADD CONSTRAINT "provider_shared_runtime_acknowledgements_provider_binding_id_agent_provider_bindings_id_fk" FOREIGN KEY ("provider_binding_id") REFERENCES "public"."agent_provider_bindings"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Legacy provider configuration stays local and unqualified. Metadata cannot
-- manufacture proof of provider isolation or capability conformance.
CREATE FUNCTION aw_v5_ensure_provider_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE provider_kind text;
BEGIN
  provider_kind := CASE NEW.adapter_type WHEN 'hermes_gateway' THEN 'hermes' WHEN 'hermes_local' THEN 'hermes' WHEN 'openclaw_gateway' THEN 'openclaw' WHEN 'paperclip_runner' THEN 'paperclip_native' ELSE 'custom' END;
  INSERT INTO agent_provider_bindings (id, agent_identity_id, provider_type, provider_endpoint_ref, provider_agent_ref)
    VALUES (NEW.id, NEW.agent_identity_id, provider_kind, 'agent_config:' || NEW.id::text, COALESCE(NULLIF(NEW.adapter_config->>'agentId', ''), NEW.id::text));
  INSERT INTO agent_presence_runtime_bindings (company_id, agent_id, agent_identity_id, provider_binding_id, provider_profile_ref, provider_session_namespace)
    VALUES (NEW.company_id, NEW.id, NEW.agent_identity_id, NEW.id, COALESCE(NULLIF(NEW.adapter_config->>'profile', ''), NEW.id::text), 'aw:v5:company:' || NEW.company_id::text || ':agent:' || NEW.id::text);
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v5_provider_binding_on_insert AFTER INSERT ON agents FOR EACH ROW EXECUTE FUNCTION aw_v5_ensure_provider_binding();
--> statement-breakpoint
DO $$
DECLARE last_id uuid; batch_ids uuid[];
BEGIN
  LOOP
    SELECT array_agg(id ORDER BY id) INTO batch_ids FROM (
      SELECT a.id FROM agents a LEFT JOIN agent_presence_runtime_bindings b ON b.agent_id = a.id AND b.company_id = a.company_id
      WHERE b.id IS NULL AND (last_id IS NULL OR a.id > last_id) ORDER BY a.id LIMIT 1000
    ) batch;
    EXIT WHEN batch_ids IS NULL;
    INSERT INTO agent_provider_bindings (id, agent_identity_id, provider_type, provider_endpoint_ref, provider_agent_ref)
      SELECT a.id, a.agent_identity_id, CASE a.adapter_type WHEN 'hermes_gateway' THEN 'hermes' WHEN 'hermes_local' THEN 'hermes' WHEN 'openclaw_gateway' THEN 'openclaw' WHEN 'paperclip_runner' THEN 'paperclip_native' ELSE 'custom' END,
        'agent_config:' || a.id::text, COALESCE(NULLIF(a.adapter_config->>'agentId', ''), a.id::text) FROM agents a WHERE a.id = ANY(batch_ids);
    INSERT INTO agent_presence_runtime_bindings (company_id, agent_id, agent_identity_id, provider_binding_id, provider_profile_ref, provider_session_namespace)
      SELECT a.company_id, a.id, a.agent_identity_id, a.id, COALESCE(NULLIF(a.adapter_config->>'profile', ''), a.id::text), 'aw:v5:company:' || a.company_id::text || ':agent:' || a.id::text FROM agents a WHERE a.id = ANY(batch_ids);
    last_id := batch_ids[array_length(batch_ids, 1)];
  END LOOP;
  IF EXISTS (SELECT 1 FROM agents a LEFT JOIN agent_presence_runtime_bindings b ON b.agent_id = a.id AND b.company_id = a.company_id WHERE b.id IS NULL) THEN RAISE EXCEPTION 'V5 provider binding backfill reconciliation failed'; END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION aw_v5_guard_role_pack_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state = 'published' AND EXISTS (SELECT 1 FROM role_packs WHERE id = OLD.role_pack_id) THEN
    RAISE EXCEPTION 'Published Role Pack versions are immutable' USING ERRCODE = '23514', CONSTRAINT = 'aw_v5_published_role_pack_immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v5_role_pack_version_immutable BEFORE UPDATE OR DELETE ON role_pack_versions FOR EACH ROW EXECUTE FUNCTION aw_v5_guard_role_pack_version();
--> statement-breakpoint
CREATE FUNCTION aw_v5_guard_role_pack_items() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id uuid; parent_state text;
BEGIN
  target_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.version_id ELSE NEW.version_id END;
  SELECT state INTO parent_state FROM role_pack_versions WHERE id = target_id FOR SHARE;
  IF parent_state = 'published' THEN
    RAISE EXCEPTION 'Published Role Pack items are immutable' USING ERRCODE = '23514', CONSTRAINT = 'aw_v5_published_role_pack_immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' AND OLD.version_id <> NEW.version_id THEN
    RAISE EXCEPTION 'Role Pack item version association is immutable' USING ERRCODE = '23514', CONSTRAINT = 'aw_v5_published_role_pack_immutable';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v5_role_pack_items_immutable BEFORE INSERT OR UPDATE OR DELETE ON role_pack_items FOR EACH ROW EXECUTE FUNCTION aw_v5_guard_role_pack_items();
