ALTER TABLE "agent_identities" DROP CONSTRAINT "agent_identities_home_company_id_companies_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_identities" ADD CONSTRAINT "agent_identities_home_company_id_companies_id_fk" FOREIGN KEY ("home_company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

-- Serialize identity association/lifecycle against presence creation and rehome.
-- Legacy single-presence termination archives only that identity. A home with
-- surviving guests must be explicitly archived or rehomed first.
CREATE FUNCTION aw_v5_guard_agent_identity_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE identity_row agent_identities%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.agent_identity_id IS NOT NULL AND NEW.agent_identity_id IS DISTINCT FROM OLD.agent_identity_id THEN
      RAISE EXCEPTION 'Agent identity association is immutable'
        USING ERRCODE = '23514', CONSTRAINT = 'aw_v5_identity_association_immutable';
    END IF;
    IF NEW.status <> 'terminated' OR OLD.status = 'terminated' THEN RETURN NEW; END IF;
  END IF;
  SELECT * INTO identity_row FROM agent_identities WHERE id = OLD.agent_identity_id FOR UPDATE;
  IF FOUND AND identity_row.home_company_id = OLD.company_id AND identity_row.status <> 'archived' THEN
    IF EXISTS (SELECT 1 FROM agents WHERE agent_identity_id = identity_row.id
      AND company_id <> OLD.company_id AND status <> 'terminated') THEN
      RAISE EXCEPTION 'Archive the identity or select a new home before removing its home presence'
        USING ERRCODE = '23514', CONSTRAINT = 'aw_v5_home_requires_rehome_or_archive';
    END IF;
    UPDATE agent_identities SET status = 'archived', updated_at = now()
      WHERE id = identity_row.id AND status <> 'archived';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v5_agent_identity_lifecycle BEFORE DELETE OR UPDATE OF status, agent_identity_id ON agents
FOR EACH ROW EXECUTE FUNCTION aw_v5_guard_agent_identity_lifecycle();
--> statement-breakpoint
CREATE FUNCTION aw_v5_guard_home_company_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.status <> 'archived' OR OLD.status = 'archived') THEN RETURN NEW; END IF;
  PERFORM id FROM agent_identities WHERE home_company_id = OLD.id AND status <> 'archived' ORDER BY id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM agent_identities i JOIN agents a ON a.agent_identity_id = i.id
    WHERE i.home_company_id = OLD.id AND i.status <> 'archived'
      AND a.company_id <> OLD.id AND a.status <> 'terminated') THEN
    RAISE EXCEPTION 'Archive or rehome shared identities before archiving their home company'
      USING ERRCODE = '23514', CONSTRAINT = 'aw_v5_home_requires_rehome_or_archive';
  END IF;
  UPDATE agent_identities SET status = 'archived', updated_at = now()
    WHERE home_company_id = OLD.id AND status <> 'archived';
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v5_home_company_lifecycle BEFORE DELETE OR UPDATE OF status ON companies
FOR EACH ROW EXECUTE FUNCTION aw_v5_guard_home_company_lifecycle();
