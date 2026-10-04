CREATE TABLE "agent_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"home_company_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"base_profile" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"appearance" jsonb,
	"description" text,
	"provider_preference" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_identities_status_check" CHECK ("agent_identities"."status" in ('active', 'paused', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "agent_presence_runtime_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"agent_identity_id" uuid NOT NULL,
	"provider_binding_id" uuid NOT NULL,
	"provider_profile_ref" text NOT NULL,
	"provider_session_namespace" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_presence_runtime_bindings_presence_uq" UNIQUE("company_id","agent_id"),
	CONSTRAINT "agent_presence_runtime_bindings_namespace_uq" UNIQUE("provider_binding_id","provider_session_namespace"),
	CONSTRAINT "agent_presence_runtime_bindings_status_check" CHECK ("agent_presence_runtime_bindings"."status" in ('active', 'degraded', 'revoked'))
);
--> statement-breakpoint
CREATE TABLE "agent_provider_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_identity_id" uuid NOT NULL,
	"provider_type" text NOT NULL,
	"provider_endpoint_ref" text,
	"provider_agent_ref" text NOT NULL,
	"isolation_mode" text DEFAULT 'isolated_per_presence' NOT NULL,
	"status" text DEFAULT 'unqualified' NOT NULL,
	"capability_snapshot" jsonb,
	"capability_snapshot_hash" text,
	"capability_discovered_at" timestamp with time zone,
	"conformance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_provider_bindings_identity_id_uq" UNIQUE("agent_identity_id","id"),
	CONSTRAINT "agent_provider_bindings_isolation_check" CHECK ("agent_provider_bindings"."isolation_mode" in ('isolated_per_presence', 'shared_trusted_runtime')),
	CONSTRAINT "agent_provider_bindings_status_check" CHECK ("agent_provider_bindings"."status" in ('unqualified', 'active', 'degraded', 'revoked'))
);
--> statement-breakpoint
CREATE TABLE "provider_shared_runtime_acknowledgements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"provider_binding_id" uuid NOT NULL,
	"acknowledged_by_user_id" text NOT NULL,
	"warning_version" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_shared_runtime_acknowledgements_company_binding_uq" UNIQUE("company_id","provider_binding_id")
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "agent_identity_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_identities" ADD CONSTRAINT "agent_identities_home_company_id_companies_id_fk" FOREIGN KEY ("home_company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_company_identity_uq" UNIQUE("company_id","agent_identity_id");--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_company_id_identity_uq" UNIQUE("company_id","id","agent_identity_id");--> statement-breakpoint
ALTER TABLE "agent_presence_runtime_bindings" ADD CONSTRAINT "agent_presence_runtime_bindings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_presence_runtime_bindings" ADD CONSTRAINT "agent_presence_runtime_bindings_company_id_agent_id_agent_identity_id_agents_company_id_id_agent_identity_id_fk" FOREIGN KEY ("company_id","agent_id","agent_identity_id") REFERENCES "public"."agents"("company_id","id","agent_identity_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_presence_runtime_bindings" ADD CONSTRAINT "agent_presence_runtime_bindings_agent_identity_id_provider_binding_id_agent_provider_bindings_agent_identity_id_id_fk" FOREIGN KEY ("agent_identity_id","provider_binding_id") REFERENCES "public"."agent_provider_bindings"("agent_identity_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_provider_bindings" ADD CONSTRAINT "agent_provider_bindings_agent_identity_id_agent_identities_id_fk" FOREIGN KEY ("agent_identity_id") REFERENCES "public"."agent_identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_shared_runtime_acknowledgements" ADD CONSTRAINT "provider_shared_runtime_acknowledgements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_shared_runtime_acknowledgements" ADD CONSTRAINT "provider_shared_runtime_acknowledgements_provider_binding_id_agent_provider_bindings_id_fk" FOREIGN KEY ("provider_binding_id") REFERENCES "public"."agent_provider_bindings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_identities_home_status_idx" ON "agent_identities" USING btree ("home_company_id","status");--> statement-breakpoint
CREATE INDEX "agent_presence_runtime_bindings_provider_idx" ON "agent_presence_runtime_bindings" USING btree ("provider_binding_id");--> statement-breakpoint
CREATE INDEX "agent_provider_bindings_identity_idx" ON "agent_provider_bindings" USING btree ("agent_identity_id");--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_agent_identity_id_agent_identities_id_fk" FOREIGN KEY ("agent_identity_id") REFERENCES "public"."agent_identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agents_identity_idx" ON "agents" USING btree ("agent_identity_id");--> statement-breakpoint

-- Expand compatibility: all insert paths (including seeds and older clients)
-- receive a fresh identity without changing local permissions or runtime state.
CREATE FUNCTION aw_v5_ensure_agent_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.agent_identity_id IS NULL THEN
    INSERT INTO agent_identities (id, name, home_company_id, status, appearance, created_at, updated_at)
    SELECT NEW.id, NEW.name, NEW.company_id,
      CASE WHEN c.status = 'active' AND NEW.status <> 'terminated' THEN 'active' ELSE 'archived' END,
      NEW.appearance, NEW.created_at, NEW.updated_at
    FROM companies c WHERE c.id = NEW.company_id;
    NEW.agent_identity_id := NEW.id;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v5_agent_identity_on_insert BEFORE INSERT ON agents
FOR EACH ROW EXECUTE FUNCTION aw_v5_ensure_agent_identity();
--> statement-breakpoint

-- Keyset batches use the primary key and same-migration identity index. There
-- is no OFFSET, no assumption about contiguous UUIDs and no full-table UPDATE.
DO $$
DECLARE batch_ids uuid[]; last_id uuid := NULL;
BEGIN
  LOOP
    SELECT array_agg(id ORDER BY id) INTO batch_ids FROM (
      SELECT id FROM agents WHERE agent_identity_id IS NULL
        AND (last_id IS NULL OR id > last_id) ORDER BY id LIMIT 1000
    ) batch;
    EXIT WHEN batch_ids IS NULL;
    INSERT INTO agent_identities (id, name, home_company_id, status, appearance, created_at, updated_at)
    SELECT a.id, a.name, a.company_id,
      CASE WHEN c.status = 'active' AND a.status <> 'terminated' THEN 'active' ELSE 'archived' END,
      a.appearance, a.created_at, a.updated_at
    FROM agents a JOIN companies c ON c.id = a.company_id
    WHERE a.id = ANY(batch_ids);
    UPDATE agents SET agent_identity_id = id
      WHERE id = ANY(batch_ids) AND agent_identity_id IS NULL;
    last_id := batch_ids[array_length(batch_ids, 1)];
  END LOOP;
  IF EXISTS (SELECT 1 FROM agents a LEFT JOIN agent_identities i ON i.id = a.agent_identity_id
    WHERE a.agent_identity_id IS NULL OR i.id IS NULL) THEN
    RAISE EXCEPTION 'V5 identity reconciliation failed';
  END IF;
  IF EXISTS (SELECT 1 FROM agent_identities i WHERE NOT EXISTS (
    SELECT 1 FROM agents a WHERE a.agent_identity_id = i.id AND a.company_id = i.home_company_id
  )) THEN RAISE EXCEPTION 'V5 home presence reconciliation failed'; END IF;
END $$;
