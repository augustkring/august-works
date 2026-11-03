CREATE TABLE "agent_model_migration_monitor_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"migration_revision_id" uuid NOT NULL,
	"draft_id" uuid NOT NULL,
	"reviewed_by_user_id" text NOT NULL,
	"request_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"review_hash" text NOT NULL,
	"published_version" integer NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"target_profile_hash" text NOT NULL,
	"target_configuration_hash" text NOT NULL,
	"target_lifecycle_hash" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"decision" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_model_migration_monitor_decision_check" CHECK ("agent_model_migration_monitor_receipts"."decision" in ('healthy','hold')),
	CONSTRAINT "agent_model_migration_monitor_version_check" CHECK ("agent_model_migration_monitor_receipts"."published_version">0),
	CONSTRAINT "agent_model_migration_monitor_hash_check" CHECK ("agent_model_migration_monitor_receipts"."request_hash" ~ '^[a-f0-9]{64}$' and "agent_model_migration_monitor_receipts"."review_hash" ~ '^[a-f0-9]{64}$'
    and "agent_model_migration_monitor_receipts"."target_profile_hash" ~ '^[a-f0-9]{64}$' and "agent_model_migration_monitor_receipts"."target_configuration_hash" ~ '^[a-f0-9]{64}$' and "agent_model_migration_monitor_receipts"."target_lifecycle_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "agent_model_migration_monitor_evidence_check" CHECK (jsonb_typeof("agent_model_migration_monitor_receipts"."evidence")='array' and jsonb_array_length("agent_model_migration_monitor_receipts"."evidence") between 1 and 10 and octet_length("agent_model_migration_monitor_receipts"."evidence"::text)<=16384)
);
--> statement-breakpoint
ALTER TABLE "agent_model_migration_monitor_receipts" ADD CONSTRAINT "agent_model_migration_monitor_receipts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_model_migration_monitor_receipts" ADD CONSTRAINT "agent_model_migration_monitor_receipts_company_id_agent_id_agents_company_id_id_fk" FOREIGN KEY ("company_id","agent_id") REFERENCES "public"."agents"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_model_migration_monitor_request_uq" ON "agent_model_migration_monitor_receipts" USING btree ("company_id","reviewed_by_user_id","request_id");--> statement-breakpoint
CREATE INDEX "agent_model_migration_monitor_revision_idx" ON "agent_model_migration_monitor_receipts" USING btree ("company_id","migration_revision_id","created_at");--> statement-breakpoint
CREATE FUNCTION aw_agent_model_migration_monitor_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'agent_model_migration_monitor_immutable' USING ERRCODE='23514';
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_agent_model_migration_monitor_immutable
  BEFORE UPDATE ON agent_model_migration_monitor_receipts
  FOR EACH ROW EXECUTE FUNCTION aw_agent_model_migration_monitor_immutable();
