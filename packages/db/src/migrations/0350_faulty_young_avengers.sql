CREATE TABLE "account_deletion_operations" (
	"user_id" text PRIMARY KEY NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"error_code" text,
	"not_before" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "account_deletion_operations_status_ck" CHECK ("account_deletion_operations"."status" in ('requested','processing','completed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "account_deletion_operations_id_uq" ON "account_deletion_operations" USING btree ("id");--> statement-breakpoint
CREATE INDEX "account_deletion_operations_work_idx" ON "account_deletion_operations" USING btree ("status","not_before");
--> statement-breakpoint
-- Native polymorphic principals cannot have a normal FK to user. Lock a real
-- profile when present and reject only V6 tombstoned identities, preserving legacy principals.
CREATE FUNCTION public.aw_v6_retired_user_membership() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.principal_type = 'user' AND NEW.status = 'active' THEN
    PERFORM 1 FROM public."user" WHERE id = NEW.principal_id FOR KEY SHARE;
    IF EXISTS (SELECT 1 FROM public.account_deletion_operations WHERE user_id = NEW.principal_id) THEN
      RAISE EXCEPTION 'Account access has been revoked' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER aw_v6_retired_user_membership BEFORE INSERT OR UPDATE ON public.company_memberships FOR EACH ROW EXECUTE FUNCTION public.aw_v6_retired_user_membership();
--> statement-breakpoint
CREATE FUNCTION public.aw_v6_retired_user_secret() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.scope = 'user' AND NEW.status <> 'deleted' THEN
    PERFORM 1 FROM public."user" WHERE id = NEW.owner_user_id FOR KEY SHARE;
    IF EXISTS (SELECT 1 FROM public.account_deletion_operations WHERE user_id = NEW.owner_user_id) THEN
      RAISE EXCEPTION 'Personal credential admission has been revoked' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER aw_v6_retired_user_secret BEFORE INSERT OR UPDATE ON public.company_secrets FOR EACH ROW EXECUTE FUNCTION public.aw_v6_retired_user_secret();
--> statement-breakpoint
CREATE FUNCTION public.aw_v6_retired_user_profile() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.account_deletion_operations WHERE user_id = NEW.id) THEN
    RAISE EXCEPTION 'Deleted profile identity cannot be recreated' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER aw_v6_retired_user_profile BEFORE INSERT ON public."user" FOR EACH ROW EXECUTE FUNCTION public.aw_v6_retired_user_profile();
