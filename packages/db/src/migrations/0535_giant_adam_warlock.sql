CREATE TABLE "delegated_context_manifest_bindings" (
	"guest_company_id" uuid NOT NULL,
	"context_manifest_id" uuid NOT NULL,
	"home_company_id" uuid NOT NULL,
	"home_agent_id" uuid NOT NULL,
	"home_agent_identity_id" uuid NOT NULL,
	"home_run_id" uuid NOT NULL,
	"scope_request_id" uuid NOT NULL,
	"responsible_user_id" text NOT NULL,
	"guest_agent_id" uuid NOT NULL,
	"guest_agent_identity_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"access_mode" text NOT NULL,
	"scope_snapshot" jsonb NOT NULL,
	"source_snapshot_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delegated_context_manifest_bindings_guest_manifest_uq" UNIQUE("guest_company_id","context_manifest_id"),
	CONSTRAINT "delegated_context_manifest_bindings_access_mode_check" CHECK ("delegated_context_manifest_bindings"."access_mode" in ('read','contribute','act')),
	CONSTRAINT "delegated_context_manifest_bindings_source_hash_check" CHECK ("delegated_context_manifest_bindings"."source_snapshot_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "delegated_context_manifest_bindings" ADD CONSTRAINT "delegated_context_manifest_bindings_guest_context_fk" FOREIGN KEY ("guest_company_id","context_manifest_id") REFERENCES "public"."context_manifests"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegated_context_manifest_bindings" ADD CONSTRAINT "delegated_context_manifest_bindings_home_presence_fk" FOREIGN KEY ("home_company_id","home_agent_id","home_agent_identity_id") REFERENCES "public"."agents"("company_id","id","agent_identity_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegated_context_manifest_bindings" ADD CONSTRAINT "delegated_context_manifest_bindings_guest_presence_fk" FOREIGN KEY ("guest_company_id","guest_agent_id","guest_agent_identity_id") REFERENCES "public"."agents"("company_id","id","agent_identity_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegated_context_manifest_bindings" ADD CONSTRAINT "delegated_context_manifest_bindings_home_run_fk" FOREIGN KEY ("home_company_id","home_agent_id","home_run_id") REFERENCES "public"."heartbeat_runs"("company_id","agent_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegated_context_manifest_bindings" ADD CONSTRAINT "delegated_context_manifest_bindings_scope_request_fk" FOREIGN KEY ("scope_request_id") REFERENCES "public"."agent_execution_scope_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "delegated_context_manifest_bindings_guest_company_idx" ON "delegated_context_manifest_bindings" USING btree ("guest_company_id","guest_agent_id","created_at");--> statement-breakpoint
CREATE INDEX "delegated_context_manifest_bindings_home_run_idx" ON "delegated_context_manifest_bindings" USING btree ("home_company_id","home_run_id");
--> statement-breakpoint
CREATE FUNCTION aw_validate_delegated_context_manifest_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  manifest_agent uuid;
  manifest_run uuid;
  actual_run heartbeat_runs%ROWTYPE;
  request agent_execution_scope_requests%ROWTYPE;
  home_identity uuid;
  guest_identity uuid;
  selected_scope jsonb;
BEGIN
  SELECT agent_id, run_id INTO manifest_agent, manifest_run
    FROM context_manifests WHERE company_id=NEW.guest_company_id AND id=NEW.context_manifest_id;
  IF manifest_agent IS NULL OR manifest_agent IS DISTINCT FROM NEW.guest_agent_id OR manifest_run IS NOT NULL THEN
    RAISE EXCEPTION 'Delegated Context must bind a guest-local manifest without a guest run';
  END IF;
  SELECT * INTO actual_run FROM heartbeat_runs
    WHERE company_id=NEW.home_company_id AND agent_id=NEW.home_agent_id AND id=NEW.home_run_id;
  IF actual_run.id IS NULL OR actual_run.responsible_user_id IS DISTINCT FROM NEW.responsible_user_id THEN
    RAISE EXCEPTION 'Delegated Context home accountability is unavailable';
  END IF;
  SELECT * INTO request FROM agent_execution_scope_requests
    WHERE id=NEW.scope_request_id AND company_id=NEW.home_company_id AND agent_id=NEW.home_agent_id
      AND run_id=NEW.home_run_id;
  IF request.id IS NULL OR request.requested_by_user_id IS DISTINCT FROM NEW.responsible_user_id
      OR request.scope IS DISTINCT FROM NEW.scope_snapshot THEN
    RAISE EXCEPTION 'Delegated Context scope request is not the exact claimed home request';
  END IF;
  IF NEW.scope_snapshot->>'primaryCompanyId' IS DISTINCT FROM NEW.home_company_id::text
      OR NEW.scope_snapshot->>'primaryAgentPresenceId' IS DISTINCT FROM NEW.home_agent_id::text
      OR jsonb_typeof(NEW.scope_snapshot->'delegatedScopes') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Delegated Context scope snapshot has a different home identity';
  END IF;
  SELECT scope INTO selected_scope FROM jsonb_array_elements(NEW.scope_snapshot->'delegatedScopes') AS scopes(scope)
    WHERE scope->>'companyId'=NEW.guest_company_id::text AND scope->>'agentPresenceId'=NEW.guest_agent_id::text;
  IF selected_scope IS NULL OR selected_scope->>'purpose' IS DISTINCT FROM NEW.purpose
      OR selected_scope->>'accessMode' IS DISTINCT FROM NEW.access_mode THEN
    RAISE EXCEPTION 'Delegated Context is not an exact scope entry';
  END IF;
  SELECT agent_identity_id INTO home_identity FROM agents
    WHERE company_id=NEW.home_company_id AND id=NEW.home_agent_id;
  SELECT agent_identity_id INTO guest_identity FROM agents
    WHERE company_id=NEW.guest_company_id AND id=NEW.guest_agent_id;
  IF home_identity IS DISTINCT FROM NEW.home_agent_identity_id OR guest_identity IS DISTINCT FROM NEW.guest_agent_identity_id
      OR home_identity IS DISTINCT FROM guest_identity THEN
    RAISE EXCEPTION 'Delegated Context presences do not share the bound identity';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER delegated_context_manifest_bindings_validate
  BEFORE INSERT ON delegated_context_manifest_bindings
  FOR EACH ROW EXECUTE FUNCTION aw_validate_delegated_context_manifest_binding();
--> statement-breakpoint
CREATE FUNCTION aw_delegated_context_binding_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Delegated Context accountability bindings are immutable';
END $$;
--> statement-breakpoint
CREATE TRIGGER delegated_context_manifest_bindings_immutable
  BEFORE UPDATE ON delegated_context_manifest_bindings
  FOR EACH ROW EXECUTE FUNCTION aw_delegated_context_binding_immutable();
--> statement-breakpoint
-- The original company-purge owner may unlink this child before it reaches a
-- home Run or scope-request parent. Unlinking the accountability row therefore
-- deletes its guest-local retained Context and its item/root closure atomically.
CREATE FUNCTION aw_delete_delegated_context_before_unlink() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM context_manifests WHERE company_id=OLD.guest_company_id AND id=OLD.context_manifest_id;
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER delegated_context_manifest_bindings_delete_context
  BEFORE DELETE ON delegated_context_manifest_bindings
  FOR EACH ROW EXECUTE FUNCTION aw_delete_delegated_context_before_unlink();
--> statement-breakpoint
-- Removing the accountable home execution or its exact claimed scope request
-- removes guest-local retained copies in the same transaction. A copy without
-- its current source authority must never survive as an orphaned proof.
CREATE FUNCTION aw_delete_delegated_contexts_for_home_run() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE binding record;
BEGIN
  FOR binding IN SELECT guest_company_id, context_manifest_id FROM delegated_context_manifest_bindings
    WHERE home_company_id=OLD.company_id AND home_run_id=OLD.id ORDER BY guest_company_id, context_manifest_id LOOP
    DELETE FROM context_manifests WHERE company_id=binding.guest_company_id AND id=binding.context_manifest_id;
  END LOOP;
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER heartbeat_runs_delete_delegated_contexts
  BEFORE DELETE ON heartbeat_runs
  FOR EACH ROW EXECUTE FUNCTION aw_delete_delegated_contexts_for_home_run();
--> statement-breakpoint
CREATE FUNCTION aw_delete_delegated_contexts_for_scope_request() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE binding record;
BEGIN
  FOR binding IN SELECT guest_company_id, context_manifest_id FROM delegated_context_manifest_bindings
    WHERE scope_request_id=OLD.id ORDER BY guest_company_id, context_manifest_id LOOP
    DELETE FROM context_manifests WHERE company_id=binding.guest_company_id AND id=binding.context_manifest_id;
  END LOOP;
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER scope_requests_delete_delegated_contexts
  BEFORE DELETE ON agent_execution_scope_requests
  FOR EACH ROW EXECUTE FUNCTION aw_delete_delegated_contexts_for_scope_request();
--> statement-breakpoint
CREATE FUNCTION aw_delete_delegated_contexts_for_presence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE binding record;
BEGIN
  FOR binding IN SELECT guest_company_id, context_manifest_id FROM delegated_context_manifest_bindings
    WHERE (home_company_id=OLD.company_id AND home_agent_id=OLD.id)
       OR (guest_company_id=OLD.company_id AND guest_agent_id=OLD.id)
    ORDER BY guest_company_id, context_manifest_id LOOP
    DELETE FROM context_manifests WHERE company_id=binding.guest_company_id AND id=binding.context_manifest_id;
  END LOOP;
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER agents_delete_delegated_contexts
  BEFORE DELETE ON agents
  FOR EACH ROW EXECUTE FUNCTION aw_delete_delegated_contexts_for_presence();
--> statement-breakpoint
CREATE FUNCTION aw_delete_delegated_contexts_for_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE binding record;
BEGIN
  FOR binding IN SELECT guest_company_id, context_manifest_id FROM delegated_context_manifest_bindings
    WHERE home_agent_identity_id=OLD.id OR guest_agent_identity_id=OLD.id
    ORDER BY guest_company_id, context_manifest_id LOOP
    DELETE FROM context_manifests WHERE company_id=binding.guest_company_id AND id=binding.context_manifest_id;
  END LOOP;
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER agent_identities_delete_delegated_contexts
  BEFORE DELETE ON agent_identities
  FOR EACH ROW EXECUTE FUNCTION aw_delete_delegated_contexts_for_identity();
--> statement-breakpoint
CREATE FUNCTION aw_delete_delegated_contexts_for_home_company() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE binding record;
BEGIN
  FOR binding IN SELECT guest_company_id, context_manifest_id FROM delegated_context_manifest_bindings
    WHERE home_company_id=OLD.id ORDER BY guest_company_id, context_manifest_id LOOP
    DELETE FROM context_manifests WHERE company_id=binding.guest_company_id AND id=binding.context_manifest_id;
  END LOOP;
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER companies_delete_delegated_contexts
  BEFORE DELETE ON companies
  FOR EACH ROW EXECUTE FUNCTION aw_delete_delegated_contexts_for_home_company();
