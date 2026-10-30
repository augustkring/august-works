-- Bind provider challenges to their actual credential generation. Native
-- password-login hooks must also fence the original pre-verification snapshot.
CREATE OR REPLACE FUNCTION aw_native_challenge_owner_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id text; owner_version integer; factor_challenge boolean;
BEGIN
  IF TG_OP='UPDATE' AND (aw_native_verification_user_id(OLD.value) IS NOT NULL
    OR (OLD.identifier LIKE '2fa-%' AND OLD.identifier NOT LIKE '2fa-attempts-%')) THEN
    IF (NEW.identifier,NEW.value,NEW.authenticator_version)
      IS DISTINCT FROM (OLD.identifier,OLD.value,OLD.authenticator_version) THEN
      RAISE EXCEPTION 'Native challenge identity and generation are immutable' USING ERRCODE='23514';
    END IF;
  END IF;
  factor_challenge:=NEW.identifier LIKE '2fa-%' AND NEW.identifier NOT LIKE '2fa-attempts-%';
  owner_id:=CASE WHEN factor_challenge THEN NEW.value ELSE aw_native_verification_user_id(NEW.value) END;
  IF owner_id IS NULL THEN
    NEW.authenticator_version:=NULL;
    RETURN NEW;
  END IF;
  SELECT authenticator_version INTO owner_version FROM "user" WHERE id=owner_id
    AND (NOT factor_challenge OR two_factor_enabled)
    AND NOT EXISTS (SELECT 1 FROM account_deletion_operations WHERE user_id=owner_id)
    FOR SHARE NOWAIT;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Native challenge owner is unavailable' USING ERRCODE='23503';
  END IF;
  IF TG_OP='UPDATE' THEN
    IF (NEW.identifier,NEW.value,NEW.authenticator_version)
      IS DISTINCT FROM (OLD.identifier,OLD.value,OLD.authenticator_version) THEN
      RAISE EXCEPTION 'Native challenge identity and generation are immutable' USING ERRCODE='23514';
    END IF;
  ELSE
    -- No client/native override can choose a generation.
    NEW.authenticator_version:=owner_version;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
-- Challenges created before generation binding have no retained first-factor
-- proof. Invalidate them rather than manufacturing a current generation.
DELETE FROM verification WHERE authenticator_version IS NULL AND (
  (identifier LIKE '2fa-%' AND identifier NOT LIKE '2fa-attempts-%')
  OR aw_native_verification_user_id(value) IS NOT NULL);
