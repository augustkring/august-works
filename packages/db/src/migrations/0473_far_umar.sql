CREATE TABLE "activation_connection_validations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"purpose_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"setup_hash" text NOT NULL,
	"health_checked_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activation_connection_validations_hash_ck" CHECK ("activation_connection_validations"."setup_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "activation_connection_validations_setup_uq" ON "activation_connection_validations" USING btree ("purpose_id","setup_hash");--> statement-breakpoint
CREATE INDEX "activation_connection_validations_company_idx" ON "activation_connection_validations" USING btree ("company_id","connection_id");
--> statement-breakpoint
-- Append-only revalidation of the current original personal purpose.
-- It never rewrites the first completion or creates Agent/business authority.
CREATE OR REPLACE FUNCTION aw_v9_activation_connection_validation_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE purpose activation_connection_consents%ROWTYPE;
BEGIN
  IF TG_OP<>'INSERT' THEN
    RAISE EXCEPTION 'Original connection validation history is immutable' USING ERRCODE='23514';
  END IF;
  SELECT * INTO purpose FROM activation_connection_consents p
    WHERE p.id=NEW.purpose_id AND p.company_id=NEW.company_id
      AND p.connection_id=NEW.connection_id AND p.status='connected' FOR SHARE;
  IF NOT FOUND OR NEW.recorded_at IS DISTINCT FROM transaction_timestamp() THEN
    RAISE EXCEPTION 'Current original connected purpose is required' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (
      SELECT 1 FROM tool_connections c
      JOIN tool_applications a ON a.id=c.application_id AND a.company_id=c.company_id
      JOIN agent_package_versions v ON v.id=purpose.package_version_id
      JOIN agent_packages pkg ON pkg.id=v.agent_package_id
      JOIN company_onboarding_runs r ON r.id=purpose.onboarding_run_id AND r.company_id=c.company_id
      JOIN companies company ON company.id=c.company_id
      JOIN "user" u ON u.id=purpose.subject_user_id
      JOIN company_memberships m ON m.company_id=c.company_id AND m.principal_type='user' AND m.principal_id=u.id
      JOIN connection_grants g ON g.connection_id=c.id AND g.company_id=c.company_id
      JOIN tool_profiles profile ON profile.company_id=c.company_id AND profile.profile_key='app:'||c.id::text
      WHERE c.id=purpose.connection_id AND c.company_id=purpose.company_id AND c.application_id=purpose.application_id
        AND c.created_by_user_id=purpose.subject_user_id AND c.credential_policy='per_user'
        AND c.auth_kind='oauth' AND c.credential_source='paperclip_vault'
        AND c.health_checked_at=NEW.health_checked_at AND c.status='active' AND c.enabled AND c.health_status='ok' AND c.health_checked_at>=c.updated_at
        AND jsonb_array_length(c.credential_secret_refs)=0 AND c.external_credential IS NULL
        AND c.config->>'sourceTemplateKey'=purpose.gallery_key AND c.config->>'connectionMethodKey'=purpose.connection_method_key
        AND a.status='active' AND a.archived_at IS NULL AND a.application_key=purpose.application_key
        AND v.state='published' AND pkg.status='active' AND v.content_hash=purpose.package_content_hash
        AND r.status='in_progress' AND r.created_by_user_id=purpose.subject_user_id AND r.version=purpose.onboarding_version
        AND r.activation_state->>'step'='access' AND r.activation_state->>'packageVersionId'=purpose.package_version_id::text
        AND company.status='active' AND u.email_verified AND m.status='active'
        AND g.kind='user' AND g.subject_user_id=purpose.subject_user_id AND g.status='active' AND g.revoked_at IS NULL
        AND NOT g.is_default AND g.external_credential IS NULL
        AND (coalesce(g.provider_tenant->'oauth'->>'accessTokenExpiresAt', c.config->'oauth'->>'expiresAt') IS NULL
          OR coalesce(g.provider_tenant->'oauth'->>'accessTokenExpiresAt', c.config->'oauth'->>'expiresAt')::timestamptz>clock_timestamp())
        AND jsonb_typeof(g.provider_tenant->'oauth'->'scopes')='array'
        AND (g.provider_tenant->'oauth'->'scopes') @> (c.config->'oauth'->'scopes')
        AND (g.provider_tenant->'oauth'->'scopes') <@ (c.config->'oauth'->'scopes')
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(g.credential_secret_refs) ref
          JOIN company_secrets s ON s.id::text=ref->>'secretId' AND s.company_id=c.company_id AND s.deleted_at IS NULL AND s.status='active'
          WHERE ref->>'configPath'='oauth.access_token')
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(g.credential_secret_refs) ref
          WHERE NOT EXISTS (SELECT 1 FROM company_secrets s WHERE s.id::text=ref->>'secretId' AND s.company_id=c.company_id AND s.deleted_at IS NULL AND s.status='active'))
        AND profile.status='active' AND profile.default_action='deny'
        AND NOT EXISTS (SELECT 1 FROM tool_profile_bindings b WHERE b.profile_id=profile.id)
        AND NOT EXISTS (SELECT 1 FROM tool_connection_installs i WHERE i.connection_id=c.id AND i.company_id=c.company_id)
        AND NOT EXISTS (SELECT 1 FROM connection_grant_delegations d WHERE d.grant_id=g.id AND d.company_id=c.company_id)
        AND (SELECT count(*) FROM connection_grants other WHERE other.company_id=c.company_id AND other.connection_id=c.id AND other.status='active' AND other.revoked_at IS NULL)=1

  ) THEN RAISE EXCEPTION 'Actual current personal revalidation evidence is required' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v9_activation_connection_validation_guard BEFORE INSERT OR UPDATE OR DELETE
ON activation_connection_validations FOR EACH ROW EXECUTE FUNCTION aw_v9_activation_connection_validation_guard();
