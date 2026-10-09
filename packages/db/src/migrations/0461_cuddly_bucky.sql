CREATE TABLE "agent_configuration_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid,
	"created_by_user_id" text NOT NULL,
	"creation_request_id" uuid NOT NULL,
	"creation_request_hash" text NOT NULL,
	"baseline_hash" text,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"step" text DEFAULT 'outcome' NOT NULL,
	"content" jsonb,
	"request_receipts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_configuration_drafts_version_check" CHECK ("agent_configuration_drafts"."version">0),
	CONSTRAINT "agent_configuration_drafts_state_check" CHECK (("agent_configuration_drafts"."status"='draft' and "agent_configuration_drafts"."content" is not null) or ("agent_configuration_drafts"."status"='discarded' and "agent_configuration_drafts"."content" is null)),
	CONSTRAINT "agent_configuration_drafts_size_check" CHECK ("agent_configuration_drafts"."content" is null or octet_length("agent_configuration_drafts"."content"::text)<=65536),
	CONSTRAINT "agent_configuration_drafts_receipts_check" CHECK (jsonb_typeof("agent_configuration_drafts"."request_receipts")='array' and jsonb_array_length("agent_configuration_drafts"."request_receipts")<=32),
	CONSTRAINT "agent_configuration_drafts_hash_check" CHECK ("agent_configuration_drafts"."creation_request_hash" ~ '^[a-f0-9]{64}$' and ("agent_configuration_drafts"."baseline_hash" is null or "agent_configuration_drafts"."baseline_hash" ~ '^[a-f0-9]{64}$'))
);
--> statement-breakpoint
ALTER TABLE "agent_configuration_drafts" ADD CONSTRAINT "agent_configuration_drafts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_configuration_drafts" ADD CONSTRAINT "agent_configuration_drafts_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_configuration_drafts" ADD CONSTRAINT "agent_configuration_drafts_company_id_agent_id_agents_company_id_id_fk" FOREIGN KEY ("company_id","agent_id") REFERENCES "public"."agents"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_configuration_drafts_request_uq" ON "agent_configuration_drafts" USING btree ("company_id","created_by_user_id","creation_request_id");--> statement-breakpoint
CREATE INDEX "agent_configuration_drafts_owner_updated_idx" ON "agent_configuration_drafts" USING btree ("company_id","created_by_user_id","updated_at");
--> statement-breakpoint
CREATE FUNCTION aw_v9_agent_configuration_draft_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.step NOT IN ('outcome','identity','instructions','knowledge','tools','authority','memory','collaboration','runtime','test','review','publish','monitor') THEN
  RAISE EXCEPTION 'agent_configuration_draft_step_invalid' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' THEN
  IF (NEW.company_id,NEW.agent_id,NEW.created_by_user_id,NEW.creation_request_id,NEW.creation_request_hash,NEW.baseline_hash,NEW.created_at)
      IS DISTINCT FROM (OLD.company_id,OLD.agent_id,OLD.created_by_user_id,OLD.creation_request_id,OLD.creation_request_hash,OLD.baseline_hash,OLD.created_at) THEN
   RAISE EXCEPTION 'agent_configuration_draft_scope_immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.version<>OLD.version+1 OR OLD.status='discarded' THEN
   RAISE EXCEPTION 'agent_configuration_draft_version_conflict' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v9_agent_configuration_draft_guard BEFORE INSERT OR UPDATE ON agent_configuration_drafts
 FOR EACH ROW EXECUTE FUNCTION aw_v9_agent_configuration_draft_guard();
