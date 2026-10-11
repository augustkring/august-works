ALTER TABLE "activation_connection_consents" ADD COLUMN "existing_setup_validated" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "activation_connection_consents" ADD CONSTRAINT "activation_connection_consents_pending_setup_ck" CHECK ("activation_connection_consents"."existing_setup_validated" or ("activation_connection_consents"."existing_connection_id" is not null and "activation_connection_consents"."supersedes_consent_id" is not null));
--> statement-breakpoint
-- Metadata review never establishes positive setup evidence. Original completion
-- and validation guards remain unchanged; only Original provider finish connects.
CREATE OR REPLACE FUNCTION aw_v9_activation_connection_existing_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT NEW.existing_setup_validated AND (NEW.existing_connection_id IS NULL OR NEW.supersedes_consent_id IS NULL) THEN
    RAISE EXCEPTION 'Pending validation requires a retained exact successor connection' USING ERRCODE='23514';
  END IF;
  IF NEW.existing_connection_id IS NOT NULL THEN
    IF (NEW.reserved_connection_id IS NOT NULL AND NEW.reserved_connection_id<>NEW.existing_connection_id) OR
       (NEW.connection_id IS NOT NULL AND NEW.connection_id<>NEW.existing_connection_id) OR
       (NEW.status='connected' AND NEW.existing_setup_validated AND NEW.connection_hash IS DISTINCT FROM NEW.existing_setup_hash) THEN
      RAISE EXCEPTION 'Adoption must retain the exact original connection and setup' USING ERRCODE='23514';
    END IF;
    IF TG_OP='INSERT' AND NOT EXISTS (
      SELECT 1 FROM tool_connections c WHERE c.id=NEW.existing_connection_id AND c.company_id=NEW.company_id
        AND c.application_id=NEW.application_id AND c.created_by_user_id=NEW.subject_user_id
        AND c.credential_policy='per_user' AND c.auth_kind='oauth' AND c.credential_source='paperclip_vault'
        AND ((NEW.existing_setup_validated AND c.status='active' AND c.enabled AND c.health_status='ok' AND c.health_checked_at>=c.updated_at)
          OR (NOT NEW.existing_setup_validated AND NEW.supersedes_consent_id IS NOT NULL
            AND (c.status='active' OR (c.status='draft' AND NOT c.enabled))))
        AND (SELECT count(*) FROM connection_grants g WHERE g.company_id=c.company_id AND g.connection_id=c.id)<=1
        AND NOT EXISTS (SELECT 1 FROM connection_grants g WHERE g.company_id=c.company_id AND g.connection_id=c.id
          AND (g.kind<>'user' OR g.subject_user_id IS DISTINCT FROM NEW.subject_user_id OR g.is_default OR g.external_credential IS NOT NULL
            OR EXISTS (SELECT 1 FROM connection_grant_delegations d WHERE d.company_id=g.company_id AND d.grant_id=g.id)
            OR (g.status='active' AND (g.revoked_at IS NOT NULL OR jsonb_typeof(g.provider_tenant->'oauth'->'scopes') IS DISTINCT FROM 'array'
              OR jsonb_typeof(c.config->'oauth'->'scopes') IS DISTINCT FROM 'array'
              OR NOT ((g.provider_tenant->'oauth'->'scopes') @> (c.config->'oauth'->'scopes')
                AND (g.provider_tenant->'oauth'->'scopes') <@ (c.config->'oauth'->'scopes'))))))
        AND c.external_credential IS NULL AND jsonb_array_length(c.credential_secret_refs)=0
        AND c.config->>'sourceTemplateKey'=NEW.gallery_key AND c.config->>'connectionMethodKey'=NEW.connection_method_key
        AND NOT EXISTS (SELECT 1 FROM activation_connection_consents p WHERE p.connection_id=c.id AND p.status<>'withdrawn')
        AND NOT EXISTS (SELECT 1 FROM tool_connection_installs i WHERE i.connection_id=c.id AND i.company_id=c.company_id)
        AND (EXISTS (SELECT 1 FROM tool_profiles profile WHERE profile.company_id=c.company_id
          AND profile.profile_key='app:'||c.id::text AND profile.status='active' AND profile.default_action='deny'
          AND NOT EXISTS (SELECT 1 FROM tool_profile_bindings b WHERE b.profile_id=profile.id))
          OR (NOT NEW.existing_setup_validated AND c.status='draft' AND NOT c.enabled
            AND NOT EXISTS (SELECT 1 FROM tool_profiles profile WHERE profile.company_id=c.company_id AND profile.profile_key='app:'||c.id::text)))
    ) THEN RAISE EXCEPTION 'Current original unassigned personal connection is required' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
