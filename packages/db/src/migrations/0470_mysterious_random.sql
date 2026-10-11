CREATE TABLE "activation_connection_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"onboarding_run_id" uuid NOT NULL,
	"subject_user_id" text NOT NULL,
	"package_version_id" uuid NOT NULL,
	"package_content_hash" text NOT NULL,
	"onboarding_version" integer NOT NULL,
	"application_id" uuid NOT NULL,
	"application_key" text NOT NULL,
	"application_hash" text NOT NULL,
	"gallery_key" text NOT NULL,
	"connection_method_key" text NOT NULL,
	"method_hash" text NOT NULL,
	"request_key" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"review_hash" text NOT NULL,
	"status" text DEFAULT 'approved' NOT NULL,
	"reserved_connection_id" uuid,
	"connection_id" uuid,
	"connection_hash" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"connected_at" timestamp with time zone,
	CONSTRAINT "activation_connection_consents_version_ck" CHECK ("activation_connection_consents"."onboarding_version">0),
	CONSTRAINT "activation_connection_consents_hash_ck" CHECK ("activation_connection_consents"."package_content_hash" ~ '^[a-f0-9]{64}$' and "activation_connection_consents"."application_hash" ~ '^[a-f0-9]{64}$' and "activation_connection_consents"."method_hash" ~ '^[a-f0-9]{64}$' and "activation_connection_consents"."request_hash" ~ '^[a-f0-9]{64}$' and "activation_connection_consents"."review_hash" ~ '^[a-f0-9]{64}$' and ("activation_connection_consents"."connection_hash" is null or "activation_connection_consents"."connection_hash" ~ '^[a-f0-9]{64}$')),
	CONSTRAINT "activation_connection_consents_status_ck" CHECK (
    ("activation_connection_consents"."status"='approved' and "activation_connection_consents"."reserved_connection_id" is null and "activation_connection_consents"."connection_id" is null and "activation_connection_consents"."connected_at" is null and "activation_connection_consents"."connection_hash" is null) or
    ("activation_connection_consents"."status"='allocating' and "activation_connection_consents"."reserved_connection_id" is not null and "activation_connection_consents"."connection_id" is null and "activation_connection_consents"."connected_at" is null and "activation_connection_consents"."connection_hash" is null) or
    ("activation_connection_consents"."status"='allocated' and "activation_connection_consents"."reserved_connection_id"="activation_connection_consents"."connection_id" and "activation_connection_consents"."connection_id" is not null and "activation_connection_consents"."connected_at" is null and "activation_connection_consents"."connection_hash" is null) or
    ("activation_connection_consents"."status"='connected' and "activation_connection_consents"."reserved_connection_id"="activation_connection_consents"."connection_id" and "activation_connection_consents"."connection_id" is not null and "activation_connection_consents"."connected_at" is not null and "activation_connection_consents"."connection_hash" is not null) or
    ("activation_connection_consents"."status"='withdrawn' and ("activation_connection_consents"."connection_id" is null or "activation_connection_consents"."reserved_connection_id"="activation_connection_consents"."connection_id") and (("activation_connection_consents"."connected_at" is null and "activation_connection_consents"."connection_hash" is null) or ("activation_connection_consents"."connected_at" is not null and "activation_connection_consents"."connection_hash" is not null and "activation_connection_consents"."connection_id" is not null)))
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "activation_connection_consents_request_uq" ON "activation_connection_consents" USING btree ("company_id","onboarding_run_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "activation_connection_consents_connection_uq" ON "activation_connection_consents" USING btree ("connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "activation_connection_consents_reserved_uq" ON "activation_connection_consents" USING btree ("reserved_connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "activation_connection_consents_live_application_uq" ON "activation_connection_consents" USING btree ("onboarding_run_id","application_id") WHERE "activation_connection_consents"."status"<>'withdrawn';--> statement-breakpoint
CREATE INDEX "activation_connection_consents_owner_idx" ON "activation_connection_consents" USING btree ("company_id","subject_user_id","onboarding_run_id");
--> statement-breakpoint
-- Original purpose identity and allocation cannot be rewritten by a later
-- setup request. Provider callbacks keep the original personal credential owner.
CREATE OR REPLACE FUNCTION aw_v9_activation_connection_consent_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Original connection consent ownership must be retained' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'approved' OR NOT EXISTS (
      SELECT 1 FROM company_onboarding_runs r JOIN companies c ON c.id=r.company_id
      JOIN "user" u ON u.id=r.created_by_user_id
      JOIN company_memberships m ON m.company_id=c.id AND m.principal_type='user' AND m.principal_id=u.id AND m.status='active'
      JOIN tool_applications a ON a.company_id=c.id AND a.id=NEW.application_id
      WHERE r.id=NEW.onboarding_run_id AND r.company_id=NEW.company_id AND r.created_by_user_id=NEW.subject_user_id
        AND r.status='in_progress' AND r.version=NEW.onboarding_version AND r.activation_state->>'step'='access'
        AND r.activation_state->>'packageVersionId'=NEW.package_version_id::text
        AND c.status='active' AND u.email_verified=true AND a.application_key=NEW.application_key AND a.status='active' AND a.archived_at IS NULL
    ) THEN RAISE EXCEPTION 'Current original onboarding purpose is required' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW)-ARRAY['status','reserved_connection_id','connection_id','connection_hash','connected_at']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['status','reserved_connection_id','connection_id','connection_hash','connected_at']) OR
     (OLD.reserved_connection_id IS NOT NULL AND NEW.reserved_connection_id IS DISTINCT FROM OLD.reserved_connection_id) OR
     (OLD.connection_id IS NOT NULL AND NEW.connection_id IS DISTINCT FROM OLD.connection_id) OR
     (OLD.connection_hash IS NOT NULL AND NEW.connection_hash IS DISTINCT FROM OLD.connection_hash) OR
     (OLD.connected_at IS NOT NULL AND NEW.connected_at IS DISTINCT FROM OLD.connected_at) OR
     NOT (NEW IS NOT DISTINCT FROM OLD OR
       (OLD.status='approved' AND NEW.status IN ('allocating','withdrawn')) OR
       (OLD.status='allocating' AND NEW.status IN ('allocated','withdrawn')) OR
       (OLD.status='allocated' AND NEW.status IN ('connected','withdrawn')) OR
       (OLD.status='connected' AND NEW.status='withdrawn')) THEN
    RAISE EXCEPTION 'Original connection consent identity or transition changed' USING ERRCODE='23514';
  END IF;
  IF NEW.status='allocated' AND NOT EXISTS (
    SELECT 1 FROM tool_connections c WHERE c.id=NEW.connection_id AND c.company_id=NEW.company_id
      AND c.application_id=NEW.application_id AND c.credential_policy='per_user' AND c.created_by_user_id=NEW.subject_user_id
  ) THEN RAISE EXCEPTION 'Actual original connection allocation is required' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v9_activation_connection_consent_guard BEFORE INSERT OR UPDATE OR DELETE
ON activation_connection_consents FOR EACH ROW EXECUTE FUNCTION aw_v9_activation_connection_consent_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v9_activation_connection_allocation_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE purpose activation_connection_consents%ROWTYPE;
BEGIN
  SELECT * INTO purpose FROM activation_connection_consents p WHERE p.company_id=NEW.company_id AND
    ((p.application_id=NEW.application_id AND p.status<>'withdrawn') OR p.connection_id=NEW.id)
    ORDER BY p.requested_at LIMIT 1 FOR SHARE;
  IF FOUND THEN
    IF (TG_OP='INSERT' AND (purpose.status<>'allocating' OR purpose.reserved_connection_id IS DISTINCT FROM NEW.id)) OR
       (TG_OP='UPDATE' AND (purpose.connection_id IS DISTINCT FROM NEW.id OR OLD.id IS DISTINCT FROM NEW.id OR OLD.company_id IS DISTINCT FROM NEW.company_id OR OLD.application_id IS DISTINCT FROM NEW.application_id)) OR
       NEW.application_id IS DISTINCT FROM purpose.application_id OR NEW.created_by_user_id IS DISTINCT FROM purpose.subject_user_id OR
       NEW.credential_policy<>'per_user' OR NEW.auth_kind<>'oauth' OR NEW.credential_source<>'paperclip_vault' OR
       jsonb_array_length(NEW.credential_secret_refs)<>0 OR NEW.external_credential IS NOT NULL OR
       NEW.config->>'sourceTemplateKey' IS DISTINCT FROM purpose.gallery_key OR
       NEW.config->>'connectionMethodKey' IS DISTINCT FROM purpose.connection_method_key THEN
      RAISE EXCEPTION 'Original approved personal connection allocation is required' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v9_activation_connection_allocation_guard BEFORE INSERT OR UPDATE
ON tool_connections FOR EACH ROW EXECUTE FUNCTION aw_v9_activation_connection_allocation_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v9_activation_connection_deferred_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE connection_uuid uuid; purpose activation_connection_consents%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME='tool_profile_bindings' THEN
    SELECT p.connection_id INTO connection_uuid FROM activation_connection_consents p
      JOIN tool_profiles profile ON profile.company_id=p.company_id AND profile.profile_key='app:'||p.connection_id::text
      WHERE profile.id=NEW.profile_id AND p.company_id=NEW.company_id LIMIT 1;
  ELSIF TG_TABLE_NAME='connection_grant_delegations' THEN
    SELECT g.connection_id INTO connection_uuid FROM connection_grants g WHERE g.id=NEW.grant_id AND g.company_id=NEW.company_id;
  ELSE connection_uuid=NEW.connection_id;
  END IF;
  SELECT * INTO purpose FROM activation_connection_consents p WHERE p.company_id=NEW.company_id AND p.connection_id=connection_uuid LIMIT 1 FOR SHARE;
  IF FOUND THEN
    IF TG_TABLE_NAME<>'connection_grants' THEN
      RAISE EXCEPTION 'Agent access needs a separate current purpose and Safe Test' USING ERRCODE='23514';
    ELSIF NEW.kind<>'user' OR NEW.subject_user_id IS DISTINCT FROM purpose.subject_user_id OR NEW.is_default THEN
      RAISE EXCEPTION 'Onboarding keeps the original personal identity' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v9_activation_connection_deferred_install BEFORE INSERT OR UPDATE ON tool_connection_installs
FOR EACH ROW EXECUTE FUNCTION aw_v9_activation_connection_deferred_guard();
--> statement-breakpoint
CREATE TRIGGER aw_v9_activation_connection_deferred_binding BEFORE INSERT OR UPDATE ON tool_profile_bindings
FOR EACH ROW EXECUTE FUNCTION aw_v9_activation_connection_deferred_guard();
--> statement-breakpoint
CREATE TRIGGER aw_v9_activation_connection_deferred_grant BEFORE INSERT OR UPDATE ON connection_grants
FOR EACH ROW EXECUTE FUNCTION aw_v9_activation_connection_deferred_guard();
--> statement-breakpoint
CREATE TRIGGER aw_v9_activation_connection_deferred_delegation BEFORE INSERT OR UPDATE ON connection_grant_delegations
FOR EACH ROW EXECUTE FUNCTION aw_v9_activation_connection_deferred_guard();
