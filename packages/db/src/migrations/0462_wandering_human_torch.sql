ALTER TABLE "agent_configuration_drafts" ADD COLUMN "kind" text DEFAULT 'custom' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_configuration_drafts" ADD COLUMN "package_version_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_configuration_drafts" ADD COLUMN "package_key" text;--> statement-breakpoint
ALTER TABLE "agent_configuration_drafts" ADD COLUMN "package_content_hash" text;--> statement-breakpoint
ALTER TABLE "agent_configuration_drafts" ADD CONSTRAINT "agent_configuration_drafts_package_version_id_agent_package_versions_id_fk" FOREIGN KEY ("package_version_id") REFERENCES "public"."agent_package_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_configuration_drafts" ADD CONSTRAINT "agent_configuration_drafts_package_check" CHECK (("agent_configuration_drafts"."kind"='custom' and "agent_configuration_drafts"."package_version_id" is null and "agent_configuration_drafts"."package_key" is null and "agent_configuration_drafts"."package_content_hash" is null) or ("agent_configuration_drafts"."kind"='hire' and "agent_configuration_drafts"."agent_id" is null and "agent_configuration_drafts"."package_version_id" is not null and "agent_configuration_drafts"."package_key" is not null and "agent_configuration_drafts"."package_content_hash" is not null and "agent_configuration_drafts"."package_content_hash" ~ '^[a-f0-9]{64}$'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v9_agent_configuration_draft_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.kind='custom' AND NEW.step NOT IN ('outcome','identity','instructions','knowledge','tools','authority','memory','collaboration','runtime','test','review','publish','monitor'))
 OR (NEW.kind='hire' AND NEW.step NOT IN ('hire_access','hire_authority','hire_test','hire_review','hire_receipt')) THEN
  RAISE EXCEPTION 'agent_configuration_draft_step_invalid' USING ERRCODE='23514';
 END IF;
 IF TG_OP='INSERT' AND NEW.kind='hire' AND NOT EXISTS (
  SELECT 1 FROM agent_package_versions v JOIN agent_packages p ON p.id=v.agent_package_id
  WHERE v.id=NEW.package_version_id AND p.package_key=NEW.package_key AND v.content_hash=NEW.package_content_hash
 ) THEN
  RAISE EXCEPTION 'hire_source_pin_invalid' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' THEN
  IF (NEW.company_id,NEW.agent_id,NEW.created_by_user_id,NEW.creation_request_id,NEW.creation_request_hash,NEW.baseline_hash,NEW.created_at,NEW.kind,NEW.package_version_id,NEW.package_key,NEW.package_content_hash)
      IS DISTINCT FROM (OLD.company_id,OLD.agent_id,OLD.created_by_user_id,OLD.creation_request_id,OLD.creation_request_hash,OLD.baseline_hash,OLD.created_at,OLD.kind,OLD.package_version_id,OLD.package_key,OLD.package_content_hash) THEN
   RAISE EXCEPTION 'agent_configuration_draft_scope_immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.version<>OLD.version+1 OR OLD.status='discarded' THEN
   RAISE EXCEPTION 'agent_configuration_draft_version_conflict' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
