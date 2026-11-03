-- Provider factor/password changes invalidate current authority in their actual
-- write transaction. No legacy session receives authentication proof.
CREATE FUNCTION aw_authenticator_changed(owner_id text, revoke_sessions boolean, revoke_challenges boolean)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  -- Native account erasure locks the user before cascading to credentials.
  -- A concurrent credential writer must retry rather than invert that order.
  PERFORM id FROM "user" WHERE id=owner_id FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE "user" SET authenticator_version=authenticator_version+1 WHERE id=owner_id;
  IF revoke_sessions THEN
    DELETE FROM "session" WHERE user_id=owner_id;
  ELSE
    UPDATE "session" SET authentication_method=NULL,authenticated_at=NULL,authenticator_version=NULL
      WHERE user_id=owner_id;
  END IF;
  DELETE FROM verification WHERE value=owner_id
    AND (revoke_challenges OR identifier LIKE 'trust-device-%');
END
$$;
--> statement-breakpoint
CREATE FUNCTION aw_authenticator_user_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    -- Native verification values are not foreign keys. Remove challenges owned
    -- by this user even when deletion reaches the native user directly.
    DELETE FROM verification WHERE value=OLD.id;
    RETURN OLD;
  END IF;
  IF OLD.phishing_resistant_required AND NOT NEW.phishing_resistant_required THEN
    RAISE EXCEPTION 'Phishing-resistant authenticator retention cannot be downgraded' USING ERRCODE='23514';
  END IF;
  IF NEW.authenticator_version IS DISTINCT FROM OLD.authenticator_version
    AND (pg_trigger_depth()<2 OR NEW.authenticator_version<>OLD.authenticator_version+1) THEN
    RAISE EXCEPTION 'Authenticator generation is owned by credential lifecycle' USING ERRCODE='23514';
  END IF;
  IF NEW.two_factor_enabled IS DISTINCT FROM OLD.two_factor_enabled THEN
    IF NEW.authenticator_version<>OLD.authenticator_version THEN
      RAISE EXCEPTION 'Authenticator generation cannot be supplied with factor activation' USING ERRCODE='23514';
    END IF;
    NEW.authenticator_version:=OLD.authenticator_version+1;
    DELETE FROM "session" WHERE user_id=OLD.id;
    DELETE FROM verification WHERE value=OLD.id;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER aw_authenticator_user_guard BEFORE UPDATE OR DELETE ON "user"
FOR EACH ROW EXECUTE FUNCTION aw_authenticator_user_guard();
--> statement-breakpoint
CREATE FUNCTION aw_authenticator_totp_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE enabled boolean;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.id<>OLD.id OR NEW.user_id<>OLD.user_id THEN
      RAISE EXCEPTION 'Authenticator identity is immutable' USING ERRCODE='23514';
    END IF;
    IF OLD.verified AND NOT NEW.verified THEN
      PERFORM aw_authenticator_changed(OLD.user_id,true,true);
      RETURN NEW;
    END IF;
    IF NEW.secret IS NOT DISTINCT FROM OLD.secret AND NEW.backup_codes IS NOT DISTINCT FROM OLD.backup_codes THEN
      RETURN NEW; -- lockout counters and native enrollment verification do not replace a factor.
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN
    PERFORM aw_authenticator_changed(OLD.user_id,true,true);
    RETURN OLD;
  END IF;
  SELECT two_factor_enabled INTO enabled FROM "user" WHERE id=NEW.user_id;
  -- A pending enrollment keeps its native session, with old proof cleared.
  -- Recovery-code consumption and rotation revoke existing sessions. The
  -- provider completion owner must rotate the current session after success.
  PERFORM aw_authenticator_changed(NEW.user_id,coalesce(enabled,false),
    TG_OP='INSERT' OR NEW.secret IS DISTINCT FROM OLD.secret);
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER aw_authenticator_totp_guard AFTER INSERT OR UPDATE OR DELETE ON two_factor
FOR EACH ROW EXECUTE FUNCTION aw_authenticator_totp_guard();
--> statement-breakpoint
CREATE FUNCTION aw_authenticator_passkey_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE required boolean;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF (NEW.id,NEW.user_id,NEW.credential_id,NEW.public_key,NEW.device_type)
      IS DISTINCT FROM (OLD.id,OLD.user_id,OLD.credential_id,OLD.public_key,OLD.device_type)
      OR NEW.counter<OLD.counter THEN
      RAISE EXCEPTION 'Passkey identity and signature counter cannot be replaced or reversed' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' THEN
    SELECT phishing_resistant_required INTO required FROM "user" WHERE id=OLD.user_id FOR UPDATE NOWAIT;
    -- User erasure has already removed its parent row; its native FK cascade
    -- must remain possible. A live account retains a usable sign-in method.
    -- The canonical irreversible account-erasure marker also owns quarantine
    -- replay. It permits destroying credentials, never recovering authority.
    IF FOUND AND NOT EXISTS (
      SELECT 1 FROM account_deletion_operations WHERE user_id=OLD.user_id)
      AND (required OR NOT EXISTS (
      SELECT 1 FROM account WHERE user_id=OLD.user_id AND provider_id='credential' AND password IS NOT NULL))
      AND NOT EXISTS (SELECT 1 FROM passkey WHERE user_id=OLD.user_id AND id<>OLD.id) THEN
      RAISE EXCEPTION 'Enroll a replacement before removing the final passkey' USING ERRCODE='23514';
    END IF;
    PERFORM aw_authenticator_changed(OLD.user_id,true,true);
    RETURN OLD;
  END IF;
  PERFORM aw_authenticator_changed(NEW.user_id,true,true);
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER aw_authenticator_passkey_guard BEFORE INSERT OR UPDATE OR DELETE ON passkey
FOR EACH ROW EXECUTE FUNCTION aw_authenticator_passkey_guard();
--> statement-breakpoint
CREATE FUNCTION aw_authenticator_password_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.provider_id='credential' AND OLD.password IS NOT NULL THEN
      PERFORM aw_authenticator_changed(OLD.user_id,true,true);
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' AND (OLD.provider_id='credential' OR NEW.provider_id='credential')
    AND (OLD.id,OLD.user_id,OLD.provider_id,OLD.issuer,OLD.account_id)
      IS DISTINCT FROM (NEW.id,NEW.user_id,NEW.provider_id,NEW.issuer,NEW.account_id) THEN
    RAISE EXCEPTION 'Password account identity is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.provider_id='credential' AND (TG_OP='INSERT' OR NEW.password IS DISTINCT FROM OLD.password) THEN
    PERFORM aw_authenticator_changed(NEW.user_id,true,true);
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER aw_authenticator_password_guard AFTER INSERT OR UPDATE OR DELETE ON account
FOR EACH ROW EXECUTE FUNCTION aw_authenticator_password_guard();
