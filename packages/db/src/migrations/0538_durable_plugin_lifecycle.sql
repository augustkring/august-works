CREATE TABLE "resource_lifecycle_events" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "resource_type" text NOT NULL,
  "resource_id" uuid NOT NULL,
  "action" text NOT NULL,
  "recipient_plugin_ids" uuid[] NOT NULL DEFAULT '{}'::uuid[],
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "resource_lifecycle_events_resource_type_check" CHECK ("resource_type" IN ('agent', 'project', 'agent_runtime')),
  CONSTRAINT "resource_lifecycle_events_action_check" CHECK (("resource_type" = 'agent_runtime' AND "action" IN ('update', 'delete')) OR "action" = 'create' OR ("resource_type" = 'project' AND "action" IN ('update', 'archive', 'delete')) OR ("resource_type" = 'agent' AND "action" IN ('pause', 'resume', 'terminate')))
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "lifecycle_required_plugin_ids" jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
CREATE INDEX "resource_lifecycle_events_company_idx" ON "resource_lifecycle_events" ("company_id", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX "resource_lifecycle_events_company_event_uq" ON "resource_lifecycle_events" ("company_id", "id");
--> statement-breakpoint
CREATE INDEX "resource_lifecycle_events_resource_order_idx" ON "resource_lifecycle_events" ("company_id", "resource_type", "resource_id", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX "resource_lifecycle_events_creation_idx" ON "resource_lifecycle_events" ("company_id", "resource_type", "resource_id") WHERE "action" = 'create';
--> statement-breakpoint
CREATE TABLE "plugin_lifecycle_acknowledgments" (
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "plugin_id" uuid NOT NULL REFERENCES "plugins"("id") ON DELETE CASCADE,
  "event_id" bigint NOT NULL,
  "acknowledged_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "plugin_lifecycle_acknowledgments" ADD CONSTRAINT "plugin_lifecycle_acknowledgments_company_event_fk" FOREIGN KEY ("company_id", "event_id") REFERENCES "resource_lifecycle_events"("company_id", "id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE UNIQUE INDEX "plugin_lifecycle_acknowledgments_pk" ON "plugin_lifecycle_acknowledgments" ("company_id", "plugin_id", "event_id");
--> statement-breakpoint
CREATE INDEX "plugin_lifecycle_acknowledgments_event_idx" ON "plugin_lifecycle_acknowledgments" ("event_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION paperclip_lifecycle_event_order() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  -- Defaults allocate identity before BEFORE triggers run. Reassign only after
  -- taking the resource lock so overlapping transactions receive revisions in
  -- lock/commit order; the abandoned identity value is a harmless gap.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text || ':' || NEW.resource_type || ':' || NEW.resource_id::text, 0));
  NEW.id := nextval(pg_get_serial_sequence('public.resource_lifecycle_events', 'id'));
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER paperclip_lifecycle_event_order BEFORE INSERT ON "resource_lifecycle_events"
  FOR EACH ROW EXECUTE FUNCTION paperclip_lifecycle_event_order();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION paperclip_record_agent_runtime(p_company uuid, p_agent uuid, p_action text DEFAULT 'update', p_recipients uuid[] DEFAULT NULL) RETURNS bigint
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE revision bigint; recipients uuid[];
BEGIN
  IF p_action <> 'delete' THEN
    PERFORM 1 FROM agents WHERE company_id = p_company AND id = p_agent AND status NOT IN ('pending_approval', 'terminated') FOR NO KEY UPDATE;
    IF NOT FOUND THEN RETURN NULL; END IF;
    IF p_recipients IS NULL THEN
      SELECT ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(lifecycle_required_plugin_ids) value)
        INTO recipients FROM agents WHERE company_id = p_company AND id = p_agent;
    ELSE recipients := p_recipients; END IF;
  ELSE recipients := coalesce(p_recipients, ARRAY[]::uuid[]); END IF;
  IF coalesce(array_length(recipients, 1), 0) = 0 THEN RETURN NULL; END IF;
  INSERT INTO resource_lifecycle_events(company_id, resource_type, resource_id, action, recipient_plugin_ids)
    VALUES (p_company, 'agent_runtime', p_agent, p_action, coalesce(recipients, ARRAY[]::uuid[])) RETURNING id INTO revision;
  RETURN revision;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION paperclip_agent_lifecycle_changed() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE before_status text; after_status text; event_action text; recipients uuid[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'pending_approval' THEN
      PERFORM paperclip_record_agent_runtime(OLD.company_id, OLD.id, 'delete', ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(OLD.lifecycle_required_plugin_ids) value));
      IF OLD.status <> 'terminated' THEN
        INSERT INTO resource_lifecycle_events(company_id, resource_type, resource_id, action) VALUES (OLD.company_id, 'agent', OLD.id, 'terminate');
      END IF;
    END IF;
    RETURN OLD;
  END IF;
  after_status := NEW.status;
  IF TG_OP = 'INSERT' THEN
    IF after_status <> 'pending_approval' THEN
      INSERT INTO resource_lifecycle_events(company_id, resource_type, resource_id, action) VALUES (NEW.company_id, 'agent', NEW.id, 'create');
      PERFORM paperclip_record_agent_runtime(NEW.company_id, NEW.id);
    END IF;
    RETURN NEW;
  END IF;
  before_status := OLD.status;
  IF before_status IS DISTINCT FROM after_status THEN
    event_action := CASE WHEN after_status = 'terminated' THEN 'terminate'
      WHEN after_status = 'paused' THEN 'pause'
      WHEN before_status = 'paused' AND after_status IN ('active','idle','running','error') THEN 'resume' ELSE NULL END;
    IF event_action IS NOT NULL THEN
      INSERT INTO resource_lifecycle_events(company_id, resource_type, resource_id, action) VALUES (NEW.company_id, 'agent', NEW.id, event_action);
    END IF;
  END IF;
  IF (to_jsonb(OLD) - ARRAY['updated_at','created_at','status','last_heartbeat_at','last_run_at','last_error','error_reason','paused_at','pause_reason'])
    IS DISTINCT FROM (to_jsonb(NEW) - ARRAY['updated_at','created_at','status','last_heartbeat_at','last_run_at','last_error','error_reason','paused_at','pause_reason'])
    OR (before_status = 'pending_approval' AND after_status NOT IN ('pending_approval','terminated')) THEN
    IF OLD.lifecycle_required_plugin_ids IS DISTINCT FROM NEW.lifecycle_required_plugin_ids THEN
      SELECT array_agg(DISTINCT recipient::uuid) INTO recipients FROM (
        SELECT value AS recipient FROM jsonb_array_elements_text(coalesce(OLD.lifecycle_required_plugin_ids, '[]'::jsonb)) value
        UNION ALL SELECT value FROM jsonb_array_elements_text(coalesce(NEW.lifecycle_required_plugin_ids, '[]'::jsonb)) value
      ) owners;
      PERFORM paperclip_record_agent_runtime(NEW.company_id, NEW.id, 'update', coalesce(recipients, ARRAY[]::uuid[]));
    ELSE
      PERFORM paperclip_record_agent_runtime(NEW.company_id, NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER paperclip_agent_lifecycle_changed AFTER INSERT OR UPDATE OR DELETE ON agents
  FOR EACH ROW EXECUTE FUNCTION paperclip_agent_lifecycle_changed();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION paperclip_project_lifecycle_changed() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE lifecycle_action text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO resource_lifecycle_events(company_id, resource_type, resource_id, action) VALUES (OLD.company_id, 'project', OLD.id, 'delete');
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO resource_lifecycle_events(company_id, resource_type, resource_id, action) VALUES (NEW.company_id, 'project', NEW.id, 'create');
    RETURN NEW;
  END IF;
  IF (to_jsonb(OLD) - ARRAY['updated_at']) IS DISTINCT FROM (to_jsonb(NEW) - ARRAY['updated_at']) THEN
    lifecycle_action := CASE WHEN OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL THEN 'archive' ELSE 'update' END;
    INSERT INTO resource_lifecycle_events(company_id, resource_type, resource_id, action) VALUES (NEW.company_id, 'project', NEW.id, lifecycle_action);
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER paperclip_project_lifecycle_changed AFTER INSERT OR UPDATE OR DELETE ON projects
  FOR EACH ROW EXECUTE FUNCTION paperclip_project_lifecycle_changed();
