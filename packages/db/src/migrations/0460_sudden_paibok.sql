ALTER TABLE "company_agent_package_installations" ADD COLUMN "installation_request_id" uuid;--> statement-breakpoint
ALTER TABLE "company_agent_package_installations" ADD COLUMN "installation_request_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX "company_agent_package_installations_request_uq" ON "company_agent_package_installations" USING btree ("company_id","installed_by_user_id","installation_request_id") WHERE "company_agent_package_installations"."installation_request_id" is not null;--> statement-breakpoint
ALTER TABLE "company_agent_package_installations" ADD CONSTRAINT "company_agent_package_installations_request_check" CHECK (("company_agent_package_installations"."installation_request_id" is null and "company_agent_package_installations"."installation_request_hash" is null) or ("company_agent_package_installations"."installation_request_id" is not null and "company_agent_package_installations"."installation_request_hash" is not null and "company_agent_package_installations"."installation_request_hash" ~ '^[a-f0-9]{64}$'));
--> statement-breakpoint
-- Native updates, suspension and uninstall retain the initial request binding.
-- V7 already enforces immutable tenant, agent and installing principal.
CREATE FUNCTION aw_v9_package_installation_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.installation_request_id, NEW.installation_request_hash) IS DISTINCT FROM
    (OLD.installation_request_id, OLD.installation_request_hash) THEN
  RAISE EXCEPTION 'package_installation_request_immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v9_package_installation_request_guard BEFORE UPDATE ON company_agent_package_installations
 FOR EACH ROW EXECUTE FUNCTION aw_v9_package_installation_request_guard();
