CREATE TABLE "enterprise_identity_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"scim_connection_id" text,
	"issuer" text NOT NULL,
	"configuration" jsonb NOT NULL,
	"operating_envelope" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"scim_token_hash" text,
	"scim_credential_id" text,
	"scim_expires_at" timestamp with time zone,
	"qualification" jsonb,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enterprise_identity_policies_provider_id_unique" UNIQUE("provider_id"),
	CONSTRAINT "enterprise_identity_policies_scim_connection_id_unique" UNIQUE("scim_connection_id"),
	CONSTRAINT "enterprise_identity_company_uq" UNIQUE("company_id"),
	CONSTRAINT "enterprise_identity_tenant_uq" UNIQUE("company_id","provider_id"),
	CONSTRAINT "enterprise_identity_state_check" CHECK ("enterprise_identity_policies"."status" in ('draft','qualified','suspended','retired')),
	CONSTRAINT "enterprise_identity_version_check" CHECK ("enterprise_identity_policies"."version">0),
	CONSTRAINT "enterprise_scim_token_hash_check" CHECK ("enterprise_identity_policies"."scim_token_hash" is null or "enterprise_identity_policies"."scim_token_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "enterprise_subject_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"issuer" text NOT NULL,
	"subject" text NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"managed_membership" boolean DEFAULT false NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enterprise_subject_binding_subject_uq" UNIQUE("company_id","issuer","subject"),
	CONSTRAINT "enterprise_subject_binding_user_uq" UNIQUE("company_id","provider_id","user_id"),
	CONSTRAINT "enterprise_subject_binding_state_check" CHECK ("enterprise_subject_bindings"."status" in ('active','revoked'))
);
--> statement-breakpoint
CREATE TABLE "enterprise_auth_scim_connection_binding" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"connection_key" text NOT NULL,
	"provisioning_domain_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"decommissioned_at" timestamp with time zone,
	"decommission_status" text DEFAULT 'active' NOT NULL,
	"decommission_cursor_user_id" text,
	"decommission_reconciled_user_count" integer DEFAULT 0 NOT NULL,
	"decommission_batch_count" integer DEFAULT 0 NOT NULL,
	"decommission_revision" integer DEFAULT 0 NOT NULL,
	"decommission_completed_at" timestamp with time zone,
	"decommission_lease_id" text,
	"decommission_lease_expires_at" timestamp with time zone,
	CONSTRAINT "enterprise_auth_scim_connection_binding_connection_key_unique" UNIQUE("connection_key")
);
--> statement-breakpoint
CREATE TABLE "enterprise_auth_scim_group" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"provisioning_domain_id" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"display_name" text NOT NULL,
	"display_name_key" text NOT NULL,
	"external_id" text,
	"external_id_key" text,
	"order_key" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "enterprise_auth_scim_group_display_name_key_unique" UNIQUE("display_name_key"),
	CONSTRAINT "enterprise_auth_scim_group_external_id_key_unique" UNIQUE("external_id_key"),
	CONSTRAINT "enterprise_auth_scim_group_order_key_unique" UNIQUE("order_key"),
	CONSTRAINT "enterprise_auth_scim_group_scope_id_uq" UNIQUE("connection_id","id")
);
--> statement-breakpoint
CREATE TABLE "enterprise_auth_scim_group_member" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"group_id" text NOT NULL,
	"scim_user_id" text NOT NULL,
	"membership_key" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "enterprise_auth_scim_group_member_membership_key_unique" UNIQUE("membership_key")
);
--> statement-breakpoint
CREATE TABLE "enterprise_auth_scim_identity_tombstone" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"provisioning_domain_id" text NOT NULL,
	"external_id" text NOT NULL,
	"external_id_key" text NOT NULL,
	"user_id" text NOT NULL,
	"profile" text NOT NULL,
	"deleted_at" timestamp with time zone NOT NULL,
	CONSTRAINT "enterprise_auth_scim_identity_tombstone_external_id_key_unique" UNIQUE("external_id_key")
);
--> statement-breakpoint
CREATE TABLE "enterprise_auth_scim_projection_grant" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"provisioning_domain_id" text NOT NULL,
	"scim_user_id" text NOT NULL,
	"user_id" text NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" text NOT NULL,
	"source_value" text,
	"role" text NOT NULL,
	"grant_key" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "enterprise_auth_scim_projection_grant_grant_key_unique" UNIQUE("grant_key")
);
--> statement-breakpoint
CREATE TABLE "enterprise_auth_scim_subject" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"profile_source_id" text,
	"revision" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "enterprise_auth_scim_subject_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "enterprise_auth_scim_user" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"provisioning_domain_id" text NOT NULL,
	"user_id" text NOT NULL,
	"connection_user_key" text NOT NULL,
	"user_name" text NOT NULL,
	"user_name_key" text NOT NULL,
	"primary_email" text NOT NULL,
	"work_email_value_index" text NOT NULL,
	"email_value_index" text NOT NULL,
	"display_name" text NOT NULL,
	"formatted_name" text NOT NULL,
	"given_name" text,
	"family_name" text,
	"serialized_emails" text NOT NULL,
	"serialized_attributes" text,
	"external_id" text,
	"external_id_key" text,
	"active" boolean NOT NULL,
	"order_key" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "enterprise_auth_scim_user_connection_user_key_unique" UNIQUE("connection_user_key"),
	CONSTRAINT "enterprise_auth_scim_user_user_name_key_unique" UNIQUE("user_name_key"),
	CONSTRAINT "enterprise_auth_scim_user_external_id_key_unique" UNIQUE("external_id_key"),
	CONSTRAINT "enterprise_auth_scim_user_order_key_unique" UNIQUE("order_key"),
	CONSTRAINT "enterprise_auth_scim_user_scope_id_uq" UNIQUE("connection_id","id")
);
--> statement-breakpoint
CREATE TABLE "enterprise_auth_sso_provider" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"issuer" text NOT NULL,
	"oidc_config" text,
	"saml_config" text,
	"user_id" text,
	"provider_id" text NOT NULL,
	"organization_id" text,
	"domain" text NOT NULL,
	CONSTRAINT "enterprise_auth_sso_provider_provider_id_unique" UNIQUE("provider_id")
);
--> statement-breakpoint
ALTER TABLE "enterprise_identity_policies" ADD CONSTRAINT "enterprise_identity_policies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise_subject_bindings" ADD CONSTRAINT "enterprise_subject_bindings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise_subject_bindings" ADD CONSTRAINT "enterprise_subject_bindings_company_id_provider_id_enterprise_identity_policies_company_id_provider_id_fk" FOREIGN KEY ("company_id","provider_id") REFERENCES "public"."enterprise_identity_policies"("company_id","provider_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise_auth_scim_connection_binding" ADD CONSTRAINT "enterprise_auth_scim_connection_binding_connection_id_enterprise_identity_policies_scim_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."enterprise_identity_policies"("scim_connection_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise_auth_scim_group" ADD CONSTRAINT "enterprise_auth_scim_group_connection_id_enterprise_identity_policies_scim_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."enterprise_identity_policies"("scim_connection_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise_auth_scim_group_member" ADD CONSTRAINT "enterprise_auth_scim_group_member_connection_id_enterprise_identity_policies_scim_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."enterprise_identity_policies"("scim_connection_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise_auth_scim_group_member" ADD CONSTRAINT "enterprise_auth_scim_group_member_group_id_enterprise_auth_scim_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."enterprise_auth_scim_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise_auth_scim_group_member" ADD CONSTRAINT "enterprise_auth_scim_group_member_scim_user_id_enterprise_auth_scim_user_id_fk" FOREIGN KEY ("scim_user_id") REFERENCES "public"."enterprise_auth_scim_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise_auth_scim_group_member" ADD CONSTRAINT "enterprise_auth_scim_group_member_connection_id_group_id_enterprise_auth_scim_group_connection_id_id_fk" FOREIGN KEY ("connection_id","group_id") REFERENCES "public"."enterprise_auth_scim_group"("connection_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise_auth_scim_group_member" ADD CONSTRAINT "enterprise_auth_scim_group_member_connection_id_scim_user_id_enterprise_auth_scim_user_connection_id_id_fk" FOREIGN KEY ("connection_id","scim_user_id") REFERENCES "public"."enterprise_auth_scim_user"("connection_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise_auth_scim_identity_tombstone" ADD CONSTRAINT "enterprise_auth_scim_identity_tombstone_connection_id_enterprise_identity_policies_scim_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."enterprise_identity_policies"("scim_connection_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise_auth_scim_identity_tombstone" ADD CONSTRAINT "enterprise_auth_scim_identity_tombstone_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise_auth_scim_projection_grant" ADD CONSTRAINT "enterprise_auth_scim_projection_grant_connection_id_enterprise_identity_policies_scim_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."enterprise_identity_policies"("scim_connection_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise_auth_scim_projection_grant" ADD CONSTRAINT "enterprise_auth_scim_projection_grant_scim_user_id_enterprise_auth_scim_user_id_fk" FOREIGN KEY ("scim_user_id") REFERENCES "public"."enterprise_auth_scim_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise_auth_scim_projection_grant" ADD CONSTRAINT "enterprise_auth_scim_projection_grant_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise_auth_scim_projection_grant" ADD CONSTRAINT "enterprise_auth_scim_projection_grant_connection_id_scim_user_id_enterprise_auth_scim_user_connection_id_id_fk" FOREIGN KEY ("connection_id","scim_user_id") REFERENCES "public"."enterprise_auth_scim_user"("connection_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise_auth_scim_subject" ADD CONSTRAINT "enterprise_auth_scim_subject_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise_auth_scim_user" ADD CONSTRAINT "enterprise_auth_scim_user_connection_id_enterprise_identity_policies_scim_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."enterprise_identity_policies"("scim_connection_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise_auth_scim_user" ADD CONSTRAINT "enterprise_auth_scim_user_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise_auth_sso_provider" ADD CONSTRAINT "enterprise_auth_sso_provider_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise_auth_sso_provider" ADD CONSTRAINT "enterprise_auth_sso_provider_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "enterprise_auth_scim_connection_binding_connection_idx" ON "enterprise_auth_scim_connection_binding" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "enterprise_auth_scim_group_connection_idx" ON "enterprise_auth_scim_group" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "enterprise_auth_scim_group_member_connection_idx" ON "enterprise_auth_scim_group_member" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "enterprise_auth_scim_identity_tombstone_connection_idx" ON "enterprise_auth_scim_identity_tombstone" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "enterprise_auth_scim_projection_grant_connection_idx" ON "enterprise_auth_scim_projection_grant" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "enterprise_auth_scim_user_connection_idx" ON "enterprise_auth_scim_user" USING btree ("connection_id");--> statement-breakpoint
-- Native lifecycle authority stays current across plugin transactions and restores.
CREATE FUNCTION aw_v7_enterprise_signing_current(p enterprise_identity_policies) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT p.configuration->>'protocol'='saml' OR EXISTS (
  SELECT 1 FROM company_secrets s JOIN company_secret_versions v ON v.secret_id=s.id AND v.version=s.latest_version
  WHERE s.id::text=p.configuration->>'privateKeySecretId' AND s.company_id=p.company_id
    AND s.scope='company' AND s.provider='local_encrypted' AND s.status='active' AND s.deleted_at IS NULL
    AND v.status='current' AND v.revoked_at IS NULL
    AND v.version::text=p.configuration->>'privateKeySecretVersion'
    AND p.qualification->'signingKey'->>'secretId'=s.id::text
    AND p.qualification->'signingKey'->>'version'=v.version::text
    AND p.qualification->'signingKey'->>'valueSha256'=v.value_sha256
 );
$$;
--> statement-breakpoint
CREATE FUNCTION aw_v7_enterprise_policy_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.id<>OLD.id OR NEW.company_id<>OLD.company_id OR NEW.provider_id<>OLD.provider_id
     OR NEW.version<OLD.version OR NEW.version>OLD.version+1
     OR (OLD.status='retired' AND NEW IS DISTINCT FROM OLD) THEN
   RAISE EXCEPTION 'enterprise_policy_identity_revision_immutable' USING ERRCODE='23514';
  END IF;
  IF (NEW.configuration IS DISTINCT FROM OLD.configuration OR NEW.operating_envelope IS DISTINCT FROM OLD.operating_envelope
      OR NEW.issuer<>OLD.issuer OR NEW.scim_connection_id IS DISTINCT FROM OLD.scim_connection_id)
     AND (NEW.version<>OLD.version+1 OR NEW.status<>'draft' OR NEW.qualification IS NOT NULL OR NEW.scim_token_hash IS NOT NULL) THEN
   RAISE EXCEPTION 'enterprise_policy_changed_baseline_requires_draft' USING ERRCODE='23514';
  END IF;
 END IF;
 IF NEW.configuration->>'issuer' IS DISTINCT FROM NEW.issuer THEN
  RAISE EXCEPTION 'enterprise_policy_issuer_configuration_mismatch' USING ERRCODE='23514';
 END IF;
 IF NEW.status='qualified' AND (NEW.qualification IS NULL
    OR coalesce(NEW.qualification->>'sha256','') !~ '^[a-f0-9]{64}$'
    OR coalesce(NEW.qualification->>'sourceRevision','') !~ '^[a-f0-9]{40}$'
    OR (NEW.qualification->>'expiresAt')::timestamptz<=now()
    OR NOT aw_v7_enterprise_signing_current(NEW)) THEN
  RAISE EXCEPTION 'enterprise_current_qualification_required' USING ERRCODE='23514';
 END IF;
 IF (NEW.scim_token_hash IS NOT NULL OR NEW.scim_credential_id IS NOT NULL OR NEW.scim_expires_at IS NOT NULL)
    AND (NEW.status<>'qualified' OR NEW.scim_connection_id IS NULL OR NEW.scim_token_hash IS NULL
       OR NEW.scim_credential_id IS NULL OR NEW.scim_expires_at IS NULL OR NEW.scim_expires_at<=now()) THEN
  RAISE EXCEPTION 'enterprise_scim_credential_current_policy_required' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER enterprise_policy_guard BEFORE INSERT OR UPDATE ON enterprise_identity_policies FOR EACH ROW EXECUTE FUNCTION aw_v7_enterprise_policy_guard();
--> statement-breakpoint
CREATE FUNCTION aw_v7_enterprise_binding_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE p enterprise_identity_policies; BEGIN
 SELECT * INTO p FROM enterprise_identity_policies WHERE company_id=NEW.company_id AND provider_id=NEW.provider_id FOR SHARE;
 IF TG_OP='UPDATE' AND (NEW.id<>OLD.id OR NEW.company_id<>OLD.company_id OR NEW.provider_id<>OLD.provider_id
   OR NEW.issuer<>OLD.issuer OR NEW.subject<>OLD.subject OR NEW.user_id<>OLD.user_id
   OR (OLD.status='revoked' AND NEW.status<>'revoked')) THEN
  RAISE EXCEPTION 'enterprise_subject_binding_terminal_identity' USING ERRCODE='23514';
 END IF;
 IF NEW.status='active' AND (p.id IS NULL OR p.status='retired' OR p.issuer<>NEW.issuer
   OR NOT EXISTS(SELECT 1 FROM "user" u WHERE u.id=NEW.user_id AND u.email_verified=true)
   OR NOT EXISTS(SELECT 1 FROM company_memberships m WHERE m.company_id=NEW.company_id AND m.principal_type='user'
     AND m.principal_id=NEW.user_id AND m.status='active' AND (NOT NEW.managed_membership OR (p.scim_connection_id IS NOT NULL AND m.membership_role<>'owner')))) THEN
  RAISE EXCEPTION 'enterprise_explicit_current_member_binding_required' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER enterprise_binding_guard BEFORE INSERT OR UPDATE ON enterprise_subject_bindings FOR EACH ROW EXECUTE FUNCTION aw_v7_enterprise_binding_guard();
--> statement-breakpoint
CREATE FUNCTION aw_v7_enterprise_scim_scope_guard() RETURNS trigger LANGUAGE plpgsql AS $$
 DECLARE r jsonb:=to_jsonb(NEW); p enterprise_identity_policies; BEGIN
 PERFORM id FROM instance_settings WHERE singleton_key='default' FOR SHARE;
 SELECT * INTO p FROM enterprise_identity_policies WHERE scim_connection_id=r->>'connection_id' FOR SHARE;
 IF p.id IS NULL OR p.status<>'qualified' OR p.company_id::text IS DISTINCT FROM coalesce(r->>'provisioning_domain_id',p.company_id::text)
  OR p.scim_token_hash IS NULL OR p.scim_expires_at<=now() OR (p.qualification->>'expiresAt')::timestamptz<=now()
  OR NOT aw_v7_enterprise_signing_current(p)
  OR NOT EXISTS(SELECT 1 FROM instance_settings WHERE singleton_key='default' AND experimental->>'enterprise_identity_v7'='true') THEN
  RAISE EXCEPTION 'enterprise_scim_current_company_namespace_required' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' AND (r->>'connection_id' IS DISTINCT FROM to_jsonb(OLD)->>'connection_id'
  OR r->>'provisioning_domain_id' IS DISTINCT FROM to_jsonb(OLD)->>'provisioning_domain_id'
  OR r->>'user_id' IS DISTINCT FROM to_jsonb(OLD)->>'user_id') THEN
  RAISE EXCEPTION 'enterprise_scim_identity_namespace_immutable' USING ERRCODE='23514';
 END IF;
 IF TG_TABLE_NAME IN ('enterprise_auth_scim_user','enterprise_auth_scim_identity_tombstone') THEN
  PERFORM b.id FROM enterprise_subject_bindings b JOIN company_memberships m
    ON m.company_id=b.company_id AND m.principal_type='user' AND m.principal_id=b.user_id
    WHERE b.company_id=p.company_id AND b.provider_id=p.provider_id AND b.issuer=p.issuer
      AND b.user_id=r->>'user_id' AND b.subject=r->>'external_id' AND b.status='active' AND b.managed_membership
      AND m.membership_role<>'owner' AND m.status IN ('active','suspended') FOR SHARE OF b,m;
  IF NOT FOUND THEN RAISE EXCEPTION 'enterprise_scim_explicit_lifecycle_binding_required' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_TABLE_NAME='enterprise_auth_scim_projection_grant' THEN
   RAISE EXCEPTION 'enterprise_scim_groups_are_not_native_permission_grants' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER enterprise_scim_scope_guard BEFORE INSERT OR UPDATE ON enterprise_auth_scim_connection_binding FOR EACH ROW EXECUTE FUNCTION aw_v7_enterprise_scim_scope_guard();
--> statement-breakpoint
CREATE TRIGGER enterprise_scim_scope_guard BEFORE INSERT OR UPDATE ON enterprise_auth_scim_user FOR EACH ROW EXECUTE FUNCTION aw_v7_enterprise_scim_scope_guard();
--> statement-breakpoint
CREATE TRIGGER enterprise_scim_scope_guard BEFORE INSERT OR UPDATE ON enterprise_auth_scim_identity_tombstone FOR EACH ROW EXECUTE FUNCTION aw_v7_enterprise_scim_scope_guard();
--> statement-breakpoint
CREATE TRIGGER enterprise_scim_scope_guard BEFORE INSERT OR UPDATE ON enterprise_auth_scim_group FOR EACH ROW EXECUTE FUNCTION aw_v7_enterprise_scim_scope_guard();
--> statement-breakpoint
CREATE TRIGGER enterprise_scim_scope_guard BEFORE INSERT OR UPDATE ON enterprise_auth_scim_group_member FOR EACH ROW EXECUTE FUNCTION aw_v7_enterprise_scim_scope_guard();
--> statement-breakpoint
CREATE TRIGGER enterprise_scim_scope_guard BEFORE INSERT OR UPDATE ON enterprise_auth_scim_projection_grant FOR EACH ROW EXECUTE FUNCTION aw_v7_enterprise_scim_scope_guard();
