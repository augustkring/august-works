-- A connected receipt is actual personal setup evidence, never an Agent grant.
CREATE OR REPLACE FUNCTION aw_v9_activation_connection_completion_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='connected' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NOT EXISTS (
      SELECT 1 FROM tool_connections c
      JOIN tool_applications a ON a.id=c.application_id AND a.company_id=c.company_id
      JOIN company_onboarding_runs r ON r.id=NEW.onboarding_run_id AND r.company_id=c.company_id
      JOIN companies company ON company.id=c.company_id
      JOIN "user" u ON u.id=NEW.subject_user_id
      JOIN company_memberships m ON m.company_id=c.company_id AND m.principal_type='user' AND m.principal_id=u.id
      JOIN connection_grants g ON g.connection_id=c.id AND g.company_id=c.company_id
      JOIN tool_profiles profile ON profile.company_id=c.company_id AND profile.profile_key='app:'||c.id::text
      WHERE c.id=NEW.connection_id AND c.company_id=NEW.company_id AND c.application_id=NEW.application_id
        AND c.created_by_user_id=NEW.subject_user_id AND c.credential_policy='per_user'
        AND c.auth_kind='oauth' AND c.credential_source='paperclip_vault'
        AND c.status='active' AND c.enabled AND c.health_status='ok' AND c.health_checked_at>=c.updated_at
        AND jsonb_array_length(c.credential_secret_refs)=0 AND c.external_credential IS NULL
        AND c.config->>'sourceTemplateKey'=NEW.gallery_key AND c.config->>'connectionMethodKey'=NEW.connection_method_key
        AND a.status='active' AND a.archived_at IS NULL AND a.application_key=NEW.application_key
        AND r.status='in_progress' AND r.created_by_user_id=NEW.subject_user_id AND r.version=NEW.onboarding_version
        AND r.activation_state->>'step'='access' AND r.activation_state->>'packageVersionId'=NEW.package_version_id::text
        AND company.status='active' AND u.email_verified AND m.status='active'
        AND g.kind='user' AND g.subject_user_id=NEW.subject_user_id AND g.status='active' AND g.revoked_at IS NULL
        AND NOT g.is_default AND g.external_credential IS NULL
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
    ) THEN RAISE EXCEPTION 'Actual current personal setup evidence is required' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v9_activation_connection_completion_guard BEFORE UPDATE
ON activation_connection_consents FOR EACH ROW EXECUTE FUNCTION aw_v9_activation_connection_completion_guard();
--> statement-breakpoint
-- Provider callbacks cannot revive credentials after withdrawal or a changed
-- onboarding purpose. Original revocation remains possible without consent.
CREATE OR REPLACE FUNCTION aw_v9_activation_connection_personal_callback_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE purpose activation_connection_consents%ROWTYPE;
BEGIN
  IF NEW.status='active' THEN
    SELECT * INTO purpose FROM activation_connection_consents p
      WHERE p.company_id=NEW.company_id AND p.connection_id=NEW.connection_id FOR SHARE;
    IF FOUND AND (purpose.status NOT IN ('allocated','connected') OR NOT EXISTS (
      SELECT 1 FROM company_onboarding_runs r JOIN companies c ON c.id=r.company_id
      JOIN "user" u ON u.id=purpose.subject_user_id
      JOIN company_memberships m ON m.company_id=c.id AND m.principal_type='user' AND m.principal_id=u.id
      WHERE r.id=purpose.onboarding_run_id AND r.company_id=purpose.company_id AND c.status='active'
        AND r.status='in_progress' AND r.created_by_user_id=u.id AND u.email_verified AND m.status='active'
        AND r.version=purpose.onboarding_version AND r.activation_state->>'step'='access'
        AND r.activation_state->>'packageVersionId'=purpose.package_version_id::text
    )) THEN RAISE EXCEPTION 'Current original personal callback purpose is required' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v9_activation_connection_personal_callback_guard BEFORE INSERT OR UPDATE
ON connection_grants FOR EACH ROW EXECUTE FUNCTION aw_v9_activation_connection_personal_callback_guard();
