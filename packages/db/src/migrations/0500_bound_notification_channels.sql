CREATE UNIQUE INDEX "chat_identity_links_company_id_uq" ON "chat_identity_links" USING btree ("company_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "saas_notifications_company_id_uq" ON "saas_notifications" USING btree ("company_id","id");--> statement-breakpoint
CREATE TABLE "notification_channel_deliveries" (
	"notification_id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"preference_id" uuid NOT NULL,
	"action_id" uuid,
	"disposition" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_channel_deliveries_disposition_ck" CHECK ("notification_channel_deliveries"."disposition" in ('staged','suppressed'))
);--> statement-breakpoint
CREATE TABLE "notification_channel_preference_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"category" text NOT NULL,
	"preference_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"receipt" jsonb NOT NULL,
	"expires_at" timestamp with time zone DEFAULT clock_timestamp() + interval '1 day' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_channel_preference_commands_category_ck" CHECK ("notification_channel_preference_commands"."category" in ('billing','runtime','approval','work_update')),
	CONSTRAINT "notification_channel_preference_commands_hash_ck" CHECK ("notification_channel_preference_commands"."request_hash" ~ '^[a-f0-9]{64}$')
);--> statement-breakpoint
CREATE TABLE "notification_channel_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"category" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"delivery_locale" text DEFAULT 'en' NOT NULL,
	"channel" text NOT NULL,
	"identity_link_id" uuid,
	"conversation_id" uuid,
	"target_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_channel_preferences_company_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "notification_channel_preferences_category_ck" CHECK ("notification_channel_preferences"."category" in ('billing','runtime','approval','work_update')),
	CONSTRAINT "notification_channel_preferences_locale_ck" CHECK ("notification_channel_preferences"."delivery_locale" in ('en','da')),
	CONSTRAINT "notification_channel_preferences_version_ck" CHECK ("notification_channel_preferences"."version" > 0),
	CONSTRAINT "notification_channel_preferences_target_ck" CHECK ((
    "notification_channel_preferences"."channel" = 'default' and "notification_channel_preferences"."identity_link_id" is null and "notification_channel_preferences"."conversation_id" is null and "notification_channel_preferences"."target_hash" is null
  ) or (
    "notification_channel_preferences"."channel" in ('slack','microsoft-teams') and "notification_channel_preferences"."target_hash" is not null and "notification_channel_preferences"."target_hash" ~ '^[a-f0-9]{64}$'
  ))
);--> statement-breakpoint
ALTER TABLE "chat_actions" ADD COLUMN "notification_id" uuid;--> statement-breakpoint
ALTER TABLE "notification_channel_deliveries" ADD CONSTRAINT "notification_channel_deliveries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_channel_deliveries" ADD CONSTRAINT "notification_channel_deliveries_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_channel_deliveries" ADD CONSTRAINT "notification_channel_deliveries_action_id_chat_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."chat_actions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_channel_deliveries" ADD CONSTRAINT "notification_channel_deliveries_notice_fk" FOREIGN KEY ("company_id","notification_id") REFERENCES "public"."saas_notifications"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_channel_deliveries" ADD CONSTRAINT "notification_channel_deliveries_preference_fk" FOREIGN KEY ("company_id","preference_id") REFERENCES "public"."notification_channel_preferences"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_channel_preference_commands" ADD CONSTRAINT "notification_channel_preference_commands_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_channel_preference_commands" ADD CONSTRAINT "notification_channel_preference_commands_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_channel_preference_commands" ADD CONSTRAINT "notification_channel_preference_commands_owner_fk" FOREIGN KEY ("company_id","preference_id") REFERENCES "public"."notification_channel_preferences"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_channel_preferences" ADD CONSTRAINT "notification_channel_preferences_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_channel_preferences" ADD CONSTRAINT "notification_channel_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_channel_preferences" ADD CONSTRAINT "notification_channel_preferences_link_fk" FOREIGN KEY ("company_id","identity_link_id") REFERENCES "public"."chat_identity_links"("company_id","id") ON DELETE SET NULL ("identity_link_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_channel_preferences" ADD CONSTRAINT "notification_channel_preferences_conversation_fk" FOREIGN KEY ("company_id","conversation_id") REFERENCES "public"."chat_conversations"("company_id","id") ON DELETE SET NULL ("conversation_id") ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_channel_preference_commands_request_uq" ON "notification_channel_preference_commands" USING btree ("company_id","user_id","request_id");--> statement-breakpoint
CREATE INDEX "notification_channel_preference_commands_expiry_idx" ON "notification_channel_preference_commands" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_channel_preferences_owner_uq" ON "notification_channel_preferences" USING btree ("company_id","user_id","category");--> statement-breakpoint
ALTER TABLE "chat_actions" ADD CONSTRAINT "chat_actions_company_notification_fk" FOREIGN KEY ("company_id","notification_id") REFERENCES "public"."saas_notifications"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_actions" ADD CONSTRAINT "chat_actions_notification_source_ck" CHECK ((
      "chat_actions"."notification_id" is null and ("chat_actions"."payload"->>'authorizationMode') is distinct from 'notification'
    ) or (
      "chat_actions"."notification_id" is not null and "chat_actions"."kind" = 'provider_effect' and ("chat_actions"."payload"->>'authorizationMode') is not distinct from 'notification'
    ));
--> statement-breakpoint
-- These guards protect copied identities. Current action admission remains with
-- the Original notification and chat owners. Clearing a withdrawn reference
-- cannot create a destination, grant, message, approval or execution result.
CREATE FUNCTION aw_guard_notification_channel_preference() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW.company_id, NEW.user_id, NEW.category) IS DISTINCT FROM
       (OLD.id, OLD.company_id, OLD.user_id, OLD.category) THEN
      RAISE EXCEPTION 'Notification preference identity is immutable' USING ERRCODE='23514';
    END IF;
    IF NEW.version = OLD.version AND NEW.channel = OLD.channel AND NEW.delivery_locale=OLD.delivery_locale AND NEW.target_hash IS NOT DISTINCT FROM OLD.target_hash
       AND (NEW.identity_link_id IS NOT DISTINCT FROM OLD.identity_link_id OR NEW.identity_link_id IS NULL)
       AND (NEW.conversation_id IS NOT DISTINCT FROM OLD.conversation_id OR NEW.conversation_id IS NULL)
       AND (NEW.identity_link_id IS NULL OR NEW.conversation_id IS NULL) THEN
      RETURN NEW; -- Original source withdrawal: keep the version, fail closed.
    END IF;
    IF NEW.version <> OLD.version + 1 THEN
      RAISE EXCEPTION 'Notification preference version is unavailable' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.version <> 1 THEN
    RAISE EXCEPTION 'Notification preference version is unavailable' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM company_memberships m JOIN companies c ON c.id=m.company_id
    JOIN "user" u ON u.id=m.principal_id
    WHERE m.company_id=NEW.company_id AND m.principal_type='user' AND m.principal_id=NEW.user_id
      AND m.status='active' AND c.status<>'archived' AND u.email_verified
  ) THEN
    RAISE EXCEPTION 'Current notification recipient is unavailable' USING ERRCODE='23514';
  END IF;
  IF NEW.channel='default' THEN RETURN NEW; END IF;
  IF NEW.identity_link_id IS NULL OR NEW.conversation_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM chat_identity_links l
    JOIN chat_external_principals p ON p.company_id=l.company_id AND p.id=l.principal_id
    JOIN chat_endpoints e ON e.company_id=l.company_id AND e.id=l.endpoint_id
    JOIN tool_connections t ON t.company_id=e.company_id AND t.id=e.connection_id
    JOIN chat_conversations v ON v.company_id=l.company_id AND v.endpoint_id=e.id AND v.id=NEW.conversation_id
    JOIN company_memberships m ON m.company_id=l.company_id AND m.principal_type='user' AND m.principal_id=NEW.user_id
    WHERE l.company_id=NEW.company_id AND l.id=NEW.identity_link_id AND l.paperclip_user_id=NEW.user_id
      AND l.status='linked' AND l.revoked_at IS NULL AND l.confirmed_at IS NOT NULL
      AND p.kind='user' AND NOT p.is_bot AND p.provider=e.provider AND p.provider_account_id=e.provider_account_id
      AND e.provider=NEW.channel AND e.status='active' AND e.allow_direct_messages
      AND t.connection_purpose='channel' AND t.transport='chat_sdk' AND t.enabled AND t.status='active'
      AND t.health_status IN ('healthy','ok') AND v.is_direct_message
      AND m.status='active' AND m.membership_role IS DISTINCT FROM 'viewer'
      AND EXISTS (SELECT 1 FROM chat_deliveries d WHERE d.company_id=l.company_id AND d.endpoint_id=e.id
        AND d.conversation_id=v.id AND d.principal_id=l.principal_id AND d.state='processed')
  ) THEN
    RAISE EXCEPTION 'Notification destination source is unavailable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER notification_channel_preference_identity_guard
BEFORE INSERT OR UPDATE ON notification_channel_preferences
FOR EACH ROW EXECUTE FUNCTION aw_guard_notification_channel_preference();
--> statement-breakpoint
CREATE FUNCTION aw_guard_notification_channel_command() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE p notification_channel_preferences%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' THEN
    RAISE EXCEPTION 'Original notification command receipts are immutable' USING ERRCODE='23514';
  END IF;
  SELECT * INTO p FROM notification_channel_preferences
    WHERE id=NEW.preference_id AND company_id=NEW.company_id;
  IF NOT FOUND OR p.user_id<>NEW.user_id OR p.category<>NEW.category
    OR NEW.receipt->>'companyId' IS DISTINCT FROM NEW.company_id::text
    OR NEW.receipt->>'userId' IS DISTINCT FROM NEW.user_id
    OR NEW.receipt->>'category' IS DISTINCT FROM NEW.category
    OR NEW.receipt->>'requestId' IS DISTINCT FROM NEW.request_id::text
    OR NEW.receipt->>'version' IS DISTINCT FROM p.version::text
    OR NEW.receipt->>'channel' IS DISTINCT FROM p.channel
    OR NEW.receipt->'preferenceApplied' IS DISTINCT FROM 'true'::jsonb
    OR NEW.receipt->'authorityGranted' IS DISTINCT FROM 'false'::jsonb
    OR NEW.receipt->'messageSent' IS DISTINCT FROM 'false'::jsonb
    OR NEW.receipt->'executionStarted' IS DISTINCT FROM 'false'::jsonb
    OR jsonb_typeof(NEW.receipt)<>'object'
    OR (SELECT count(*) FROM jsonb_object_keys(NEW.receipt))<>10
    OR NEW.expires_at<=NEW.created_at OR NEW.expires_at>NEW.created_at+interval '1 day 1 minute'
  THEN
    RAISE EXCEPTION 'Original notification command receipt identity is unavailable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER notification_channel_command_identity_guard
BEFORE INSERT OR UPDATE ON notification_channel_preference_commands
FOR EACH ROW EXECUTE FUNCTION aw_guard_notification_channel_command();
--> statement-breakpoint
CREATE FUNCTION aw_guard_notification_channel_delivery() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE n saas_notifications%ROWTYPE; p notification_channel_preferences%ROWTYPE; a chat_actions%ROWTYPE; original saas_notifications%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.notification_id=OLD.notification_id AND NEW.company_id=OLD.company_id AND NEW.user_id=OLD.user_id
       AND NEW.preference_id=OLD.preference_id AND NEW.disposition=OLD.disposition AND NEW.created_at=OLD.created_at
       AND NEW.action_id IS NULL THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'Original notification delivery membership is immutable' USING ERRCODE='23514';
  END IF;
  SELECT * INTO n FROM saas_notifications WHERE id=NEW.notification_id AND company_id=NEW.company_id;
  IF NOT FOUND OR n.user_id<>NEW.user_id THEN
    RAISE EXCEPTION 'Original notification source is unavailable' USING ERRCODE='23514';
  END IF;
  SELECT * INTO p FROM notification_channel_preferences WHERE id=NEW.preference_id AND company_id=NEW.company_id;
  IF NOT FOUND OR p.user_id<>NEW.user_id OR p.category<>n.category THEN
    RAISE EXCEPTION 'Original notification preference is unavailable' USING ERRCODE='23514';
  END IF;
  IF NEW.disposition='suppressed' THEN
    IF NEW.action_id IS NOT NULL THEN RAISE EXCEPTION 'Suppressed notification has no delivery effect' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO a FROM chat_actions WHERE id=NEW.action_id AND company_id=NEW.company_id;
  IF NOT FOUND OR a.kind<>'provider_effect' OR a.notification_id IS NULL
    OR a.payload->>'authorizationMode' IS DISTINCT FROM 'notification'
    OR a.payload->>'notificationPreferenceVersion' IS DISTINCT FROM p.version::text THEN
    RAISE EXCEPTION 'Original notification effect is unavailable' USING ERRCODE='23514';
  END IF;
  SELECT * INTO original FROM saas_notifications WHERE id=a.notification_id AND company_id=NEW.company_id;
  IF NOT FOUND OR original.user_id<>NEW.user_id OR original.category<>n.category THEN
    RAISE EXCEPTION 'Original notification digest source is unavailable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER notification_channel_delivery_identity_guard
BEFORE INSERT OR UPDATE ON notification_channel_deliveries
FOR EACH ROW EXECUTE FUNCTION aw_guard_notification_channel_delivery();
