-- A new explicit C3 may reuse current healthy personal setup after withdrawal.
-- Every earlier approval, first completion and validation remains immutable.
CREATE OR REPLACE FUNCTION aw_v9_activation_connection_successor_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous activation_connection_consents%ROWTYPE;
BEGIN
  IF NEW.supersedes_consent_id IS NULL THEN
    IF NEW.existing_connection_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM activation_connection_consents p
      WHERE p.company_id=NEW.company_id AND p.connection_id=NEW.existing_connection_id
    ) THEN RAISE EXCEPTION 'A retained purpose requires its exact withdrawn parent' USING ERRCODE='23514'; END IF;
  ELSE
    SELECT * INTO previous FROM activation_connection_consents p
      WHERE p.id=NEW.supersedes_consent_id AND p.company_id=NEW.company_id FOR SHARE;
    IF NOT FOUND OR previous.status<>'withdrawn' OR NEW.existing_connection_id IS NULL OR
       previous.connection_id IS DISTINCT FROM NEW.existing_connection_id OR
       previous.subject_user_id IS DISTINCT FROM NEW.subject_user_id OR
       previous.onboarding_run_id IS DISTINCT FROM NEW.onboarding_run_id OR
       previous.application_id IS DISTINCT FROM NEW.application_id OR
       previous.gallery_key IS DISTINCT FROM NEW.gallery_key OR
       previous.connection_method_key IS DISTINCT FROM NEW.connection_method_key OR
       previous.method_hash IS DISTINCT FROM NEW.method_hash OR
       EXISTS (SELECT 1 FROM activation_connection_consents child WHERE child.supersedes_consent_id=previous.id) THEN
      RAISE EXCEPTION 'A successor needs the exact terminal personal purpose without another successor' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v9_activation_connection_successor_guard BEFORE INSERT
ON activation_connection_consents FOR EACH ROW EXECUTE FUNCTION aw_v9_activation_connection_successor_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v9_activation_connection_existing_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.existing_connection_id IS NOT NULL THEN
    IF (NEW.reserved_connection_id IS NOT NULL AND NEW.reserved_connection_id<>NEW.existing_connection_id) OR
       (NEW.connection_id IS NOT NULL AND NEW.connection_id<>NEW.existing_connection_id) OR
       (NEW.status='connected' AND NEW.connection_hash IS DISTINCT FROM NEW.existing_setup_hash) THEN
      RAISE EXCEPTION 'Adoption must retain the exact original connection and setup' USING ERRCODE='23514';
    END IF;
    IF TG_OP='INSERT' AND NOT EXISTS (
      SELECT 1 FROM tool_connections c WHERE c.id=NEW.existing_connection_id AND c.company_id=NEW.company_id
        AND c.application_id=NEW.application_id AND c.created_by_user_id=NEW.subject_user_id
        AND c.credential_policy='per_user' AND c.auth_kind='oauth' AND c.credential_source='paperclip_vault'
        AND c.status='active' AND c.enabled AND c.health_status='ok' AND c.health_checked_at>=c.updated_at
        AND c.external_credential IS NULL AND jsonb_array_length(c.credential_secret_refs)=0
        AND c.config->>'sourceTemplateKey'=NEW.gallery_key AND c.config->>'connectionMethodKey'=NEW.connection_method_key
        AND NOT EXISTS (SELECT 1 FROM activation_connection_consents p WHERE p.connection_id=c.id AND p.status<>'withdrawn')
        AND NOT EXISTS (SELECT 1 FROM tool_connection_installs i WHERE i.connection_id=c.id AND i.company_id=c.company_id)
        AND EXISTS (SELECT 1 FROM tool_profiles profile WHERE profile.company_id=c.company_id
          AND profile.profile_key='app:'||c.id::text AND profile.status='active' AND profile.default_action='deny'
          AND NOT EXISTS (SELECT 1 FROM tool_profile_bindings b WHERE b.profile_id=profile.id))
    ) THEN RAISE EXCEPTION 'Current original unassigned personal connection is required' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v9_activation_connection_allocation_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE purpose activation_connection_consents%ROWTYPE;
BEGIN
  SELECT * INTO purpose FROM activation_connection_consents p WHERE p.company_id=NEW.company_id AND
    ((p.application_id=NEW.application_id AND p.status<>'withdrawn') OR p.connection_id=NEW.id)
    ORDER BY (p.status='withdrawn'), p.requested_at DESC, p.id DESC LIMIT 1 FOR SHARE;
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
  SELECT * INTO purpose FROM activation_connection_consents p WHERE p.company_id=NEW.company_id AND p.connection_id=connection_uuid ORDER BY (p.status='withdrawn'), p.requested_at DESC, p.id DESC LIMIT 1 FOR SHARE;
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
CREATE OR REPLACE FUNCTION aw_v9_activation_connection_personal_callback_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE purpose activation_connection_consents%ROWTYPE;
BEGIN
  IF NEW.status='active' THEN
    SELECT * INTO purpose FROM activation_connection_consents p
      WHERE p.company_id=NEW.company_id AND p.connection_id=NEW.connection_id ORDER BY (p.status='withdrawn'), p.requested_at DESC, p.id DESC LIMIT 1 FOR SHARE;
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
          JOIN company_secrets s ON s.id::text=ref->>'secretId' AND s.company_id=c.company_id AND s.deleted_at IS NULL AND s.status='active' AND s.updated_at<=c.health_checked_at
          WHERE ref->>'configPath'='oauth.access_token')
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(g.credential_secret_refs) ref
          WHERE NOT EXISTS (SELECT 1 FROM company_secrets s WHERE s.id::text=ref->>'secretId' AND s.company_id=c.company_id AND s.deleted_at IS NULL AND s.status='active' AND s.updated_at<=c.health_checked_at))
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
          JOIN company_secrets s ON s.id::text=ref->>'secretId' AND s.company_id=c.company_id AND s.deleted_at IS NULL AND s.status='active' AND s.updated_at<=c.health_checked_at
          WHERE ref->>'configPath'='oauth.access_token')
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(g.credential_secret_refs) ref
          WHERE NOT EXISTS (SELECT 1 FROM company_secrets s WHERE s.id::text=ref->>'secretId' AND s.company_id=c.company_id AND s.deleted_at IS NULL AND s.status='active' AND s.updated_at<=c.health_checked_at))
        AND profile.status='active' AND profile.default_action='deny'
        AND NOT EXISTS (SELECT 1 FROM tool_profile_bindings b WHERE b.profile_id=profile.id)
        AND NOT EXISTS (SELECT 1 FROM tool_connection_installs i WHERE i.connection_id=c.id AND i.company_id=c.company_id)
        AND NOT EXISTS (SELECT 1 FROM connection_grant_delegations d WHERE d.grant_id=g.id AND d.company_id=c.company_id)
        AND (SELECT count(*) FROM connection_grants other WHERE other.company_id=c.company_id AND other.connection_id=c.id AND other.status='active' AND other.revoked_at IS NULL)=1

  ) THEN RAISE EXCEPTION 'Actual current personal revalidation evidence is required' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
