-- Better Auth 1.7.2 stores passkey ceremonies as typed JSON, including the
-- registration user's name and ID. Other verification values remain opaque.
CREATE FUNCTION aw_native_verification_user_id(stored_value text)
RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE payload jsonb;
BEGIN
  BEGIN
    payload:=stored_value::jsonb;
  EXCEPTION WHEN data_exception THEN
    RETURN NULL;
  END;
  IF payload->>'type' IN ('registration','authentication')
    AND jsonb_typeof(payload->'userData'->'id')='string' THEN
    -- Discoverable authentication has no account until its assertion verifies.
    IF payload->>'type'='authentication' AND payload->'userData'->>'id'='' THEN
      RETURN NULL;
    END IF;
    RETURN payload->'userData'->>'id';
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE FUNCTION aw_native_challenge_owner_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id text;
BEGIN
  owner_id:=aw_native_verification_user_id(NEW.value);
  IF owner_id IS NULL THEN RETURN NEW; END IF;
  -- Serialize challenge creation with credential changes and account erasure.
  -- A challenge must not recreate identity data after its parent was erased.
  PERFORM id FROM "user" WHERE id=owner_id
    AND NOT EXISTS (SELECT 1 FROM account_deletion_operations WHERE user_id=owner_id)
    FOR SHARE NOWAIT;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Native challenge owner is unavailable' USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER aw_native_challenge_owner_guard BEFORE INSERT OR UPDATE ON verification
FOR EACH ROW EXECUTE FUNCTION aw_native_challenge_owner_guard();
--> statement-breakpoint
CREATE FUNCTION aw_native_challenge_lifetime_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- AFTER observes the generation assigned by the existing native user guard.
  IF TG_OP='DELETE' OR NEW.authenticator_version<>OLD.authenticator_version THEN
    DELETE FROM verification WHERE aw_native_verification_user_id(value)=OLD.id;
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER aw_native_challenge_lifetime_guard AFTER UPDATE OR DELETE ON "user"
FOR EACH ROW EXECUTE FUNCTION aw_native_challenge_lifetime_guard();
