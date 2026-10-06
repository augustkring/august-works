CREATE TABLE "security_event_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"configuration_id" uuid NOT NULL,
	"configuration_version" integer NOT NULL,
	"event_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_id" uuid,
	"lease_expires_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"delivered_at" timestamp with time zone,
	"last_failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "security_event_delivery_dedup_uq" UNIQUE("company_id","event_id"),
	CONSTRAINT "security_event_delivery_state" CHECK ("security_event_deliveries"."status" in ('pending','sending','delivered','failed','cancelled') and "security_event_deliveries"."attempts" between 0 and 5 and "security_event_deliveries"."configuration_version">0)
);
--> statement-breakpoint
CREATE TABLE "security_event_export_configurations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"endpoint" text NOT NULL,
	"signing_secret_id" uuid NOT NULL,
	"signing_secret_version" integer NOT NULL,
	"signing_secret_hash" text NOT NULL,
	"actions" jsonb NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"approved_by_user_id" text NOT NULL,
	"dropped_events" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "security_event_export_company_uq" UNIQUE("company_id"),
	CONSTRAINT "security_event_export_scope_uq" UNIQUE("company_id","id"),
	CONSTRAINT "security_event_export_shape" CHECK ("security_event_export_configurations"."version">0 and "security_event_export_configurations"."signing_secret_version">0 and "security_event_export_configurations"."dropped_events">=0 and "security_event_export_configurations"."signing_secret_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_company_id_uq" UNIQUE("company_id","id");
--> statement-breakpoint
ALTER TABLE "security_event_deliveries" ADD CONSTRAINT "security_event_deliveries_company_id_configuration_id_security_event_export_configurations_company_id_id_fk" FOREIGN KEY ("company_id","configuration_id") REFERENCES "public"."security_event_export_configurations"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_event_deliveries" ADD CONSTRAINT "security_event_deliveries_company_id_event_id_activity_log_company_id_id_fk" FOREIGN KEY ("company_id","event_id") REFERENCES "public"."activity_log"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_event_export_configurations" ADD CONSTRAINT "security_event_export_configurations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_event_export_configurations" ADD CONSTRAINT "security_event_export_configurations_signing_secret_id_company_secrets_id_fk" FOREIGN KEY ("signing_secret_id") REFERENCES "public"."company_secrets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "security_event_delivery_ready_idx" ON "security_event_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "security_event_delivery_company_idx" ON "security_event_deliveries" USING btree ("company_id","expires_at");--> statement-breakpoint
--> statement-breakpoint
CREATE FUNCTION aw_v7_security_export_config_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='UPDATE' AND (NEW.id<>OLD.id OR NEW.company_id<>OLD.company_id OR NEW.version<OLD.version OR NEW.version>OLD.version+1
  OR ((NEW.endpoint IS DISTINCT FROM OLD.endpoint OR NEW.signing_secret_id<>OLD.signing_secret_id
     OR NEW.signing_secret_version<>OLD.signing_secret_version OR NEW.actions IS DISTINCT FROM OLD.actions OR NEW.enabled<>OLD.enabled
     OR NEW.approved_by_user_id<>OLD.approved_by_user_id) AND NEW.version<>OLD.version+1)) THEN
  RAISE EXCEPTION 'security_export_configuration_revision_required' USING ERRCODE='23514';
 END IF;
 IF NEW.enabled AND (NOT EXISTS(SELECT 1 FROM company_memberships m WHERE m.company_id=NEW.company_id AND m.principal_type='user' AND m.principal_id=NEW.approved_by_user_id AND m.status='active' AND m.membership_role='owner')
  OR NOT EXISTS(SELECT 1 FROM company_secrets s JOIN company_secret_versions v ON v.secret_id=s.id AND v.version=s.latest_version
   WHERE s.company_id=NEW.company_id AND s.id=NEW.signing_secret_id AND s.scope='company' AND s.provider='local_encrypted'
     AND s.status='active' AND s.deleted_at IS NULL AND v.version=NEW.signing_secret_version AND v.status='current'
     AND v.revoked_at IS NULL AND v.value_sha256=NEW.signing_secret_hash)) THEN
  RAISE EXCEPTION 'security_export_current_native_owner_and_key_required' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER security_export_config_guard BEFORE INSERT OR UPDATE ON security_event_export_configurations FOR EACH ROW EXECUTE FUNCTION aw_v7_security_export_config_guard();
--> statement-breakpoint
CREATE FUNCTION aw_v7_security_event_enqueue() RETURNS trigger LANGUAGE plpgsql AS $$
 DECLARE c security_event_export_configurations; BEGIN
 IF NOT EXISTS(SELECT 1 FROM instance_settings WHERE singleton_key='default' AND experimental->>'security_event_export_v7'='true') THEN RETURN NEW; END IF;
 SELECT * INTO c FROM security_event_export_configurations WHERE company_id=NEW.company_id AND enabled AND actions ? NEW.action FOR UPDATE;
 IF c.id IS NULL THEN RETURN NEW; END IF;
 -- Serialize through the native configuration lock: maximum 1000 queued events
 -- per company, a 24-hour delivery/metadata lifetime, no backfill or extra log.
 IF (SELECT count(*) FROM security_event_deliveries WHERE company_id=NEW.company_id AND status IN ('pending','sending') AND expires_at>now())>=1000 THEN
  UPDATE security_event_export_configurations SET dropped_events=dropped_events+1 WHERE id=c.id;
  RETURN NEW;
 END IF;
 INSERT INTO security_event_deliveries(company_id,configuration_id,configuration_version,event_id,expires_at)
  VALUES(NEW.company_id,c.id,c.version,NEW.id,now()+interval '24 hours') ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER security_event_enqueue AFTER INSERT ON activity_log FOR EACH ROW EXECUTE FUNCTION aw_v7_security_event_enqueue();
--> statement-breakpoint
CREATE FUNCTION aw_v7_security_event_delivery_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='UPDATE' AND (NEW.id<>OLD.id OR NEW.company_id<>OLD.company_id OR NEW.configuration_id<>OLD.configuration_id
   OR NEW.configuration_version<>OLD.configuration_version OR NEW.event_id<>OLD.event_id OR NEW.expires_at<>OLD.expires_at
   OR NEW.attempts<OLD.attempts OR NEW.attempts>OLD.attempts+1 OR (OLD.status IN ('delivered','failed','cancelled') AND NEW IS DISTINCT FROM OLD)) THEN
  RAISE EXCEPTION 'security_export_delivery_terminal_or_identity_changed' USING ERRCODE='23514';
 END IF;
 IF NEW.expires_at>NEW.created_at+interval '24 hours' THEN RAISE EXCEPTION 'security_export_retention_bound' USING ERRCODE='23514'; END IF;
 IF NEW.status='sending' AND (NEW.lease_id IS NULL OR NEW.lease_expires_at IS NULL OR NEW.lease_expires_at>now()+interval '90 seconds') THEN
  RAISE EXCEPTION 'security_export_delivery_lease_required' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER security_event_delivery_guard BEFORE INSERT OR UPDATE ON security_event_deliveries FOR EACH ROW EXECUTE FUNCTION aw_v7_security_event_delivery_guard();
