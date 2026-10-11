-- Adoption refers to the real original row, without another allocation or
-- credential owner. Existing receipt fields remain immutable under 0470.
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
        AND NOT EXISTS (SELECT 1 FROM activation_connection_consents p WHERE p.connection_id=c.id)
        AND NOT EXISTS (SELECT 1 FROM tool_connection_installs i WHERE i.connection_id=c.id AND i.company_id=c.company_id)
        AND EXISTS (SELECT 1 FROM tool_profiles profile WHERE profile.company_id=c.company_id
          AND profile.profile_key='app:'||c.id::text AND profile.status='active' AND profile.default_action='deny'
          AND NOT EXISTS (SELECT 1 FROM tool_profile_bindings b WHERE b.profile_id=profile.id))
    ) THEN RAISE EXCEPTION 'Current original unassigned personal connection is required' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v9_activation_connection_existing_guard BEFORE INSERT OR UPDATE
ON activation_connection_consents FOR EACH ROW EXECUTE FUNCTION aw_v9_activation_connection_existing_guard();
