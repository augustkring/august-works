CREATE TABLE "resource_lifecycle_events" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "resource_type" text NOT NULL,
  "resource_id" uuid NOT NULL,
  "action" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "resource_lifecycle_events_resource_type_check" CHECK ("resource_type" IN ('agent', 'project', 'agent_runtime')),
  CONSTRAINT "resource_lifecycle_events_action_check" CHECK (("resource_type" = 'agent_runtime' AND "action" IN ('update', 'delete')) OR "action" = 'create' OR ("resource_type" = 'project' AND "action" IN ('update', 'archive', 'delete')) OR ("resource_type" = 'agent' AND "action" IN ('pause', 'resume', 'terminate')))
);
--> statement-breakpoint
CREATE INDEX "resource_lifecycle_events_company_idx" ON "resource_lifecycle_events" ("company_id", "id");
--> statement-breakpoint
CREATE INDEX "resource_lifecycle_events_resource_order_idx" ON "resource_lifecycle_events" ("company_id", "resource_type", "resource_id", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX "resource_lifecycle_events_creation_idx" ON "resource_lifecycle_events" ("company_id", "resource_type", "resource_id") WHERE "action" = 'create';
--> statement-breakpoint
CREATE TABLE "plugin_lifecycle_acknowledgments" (
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "plugin_id" uuid NOT NULL REFERENCES "plugins"("id") ON DELETE CASCADE,
  "event_id" bigint NOT NULL REFERENCES "resource_lifecycle_events"("id") ON DELETE CASCADE,
  "acknowledged_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "plugin_lifecycle_acknowledgments_pk" ON "plugin_lifecycle_acknowledgments" ("company_id", "plugin_id", "event_id");
--> statement-breakpoint
CREATE INDEX "plugin_lifecycle_acknowledgments_event_idx" ON "plugin_lifecycle_acknowledgments" ("event_id");
