ALTER TABLE "trust_document_registry" ADD CONSTRAINT "trust_document_registry_exact_version_uq" UNIQUE("company_id","id","document_revision_id","version");--> statement-breakpoint
CREATE TABLE "trust_document_access_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"registry_entry_id" uuid NOT NULL,
	"document_revision_id" uuid NOT NULL,
	"document_version" text NOT NULL,
	"grantee_user_id" text NOT NULL,
	"granted_by_user_id" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"request_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"surface" text NOT NULL,
	CONSTRAINT "trust_document_access_grants_company_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "trust_document_access_grants_request_uq" UNIQUE("company_id","granted_by_user_id","request_id"),
	CONSTRAINT "trust_document_access_grants_hash_ck" CHECK ("trust_document_access_grants"."request_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "trust_document_access_grants_version_ck" CHECK (length(btrim("trust_document_access_grants"."document_version")) between 1 and 128),
	CONSTRAINT "trust_document_access_grants_surface_ck" CHECK (length(btrim("trust_document_access_grants"."surface")) between 1 and 128)
);
--> statement-breakpoint
CREATE TABLE "trust_document_access_revocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"grant_receipt_id" uuid NOT NULL,
	"revoked_by_user_id" text NOT NULL,
	"revoked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"surface" text NOT NULL,
	CONSTRAINT "trust_document_access_revocations_grant_uq" UNIQUE("company_id","grant_receipt_id"),
	CONSTRAINT "trust_document_access_revocations_request_uq" UNIQUE("company_id","revoked_by_user_id","request_id"),
	CONSTRAINT "trust_document_access_revocations_hash_ck" CHECK ("trust_document_access_revocations"."request_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "trust_document_access_revocations_surface_ck" CHECK (length(btrim("trust_document_access_revocations"."surface")) between 1 and 128)
);
--> statement-breakpoint
ALTER TABLE "trust_document_access_grants" ADD CONSTRAINT "trust_document_access_grants_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_document_access_grants" ADD CONSTRAINT "trust_document_access_grants_registry_fk" FOREIGN KEY ("company_id","registry_entry_id","document_revision_id","document_version") REFERENCES "public"."trust_document_registry"("company_id","id","document_revision_id","version") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_document_access_revocations" ADD CONSTRAINT "trust_document_access_revocations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_document_access_revocations" ADD CONSTRAINT "trust_document_access_revocations_grant_fk" FOREIGN KEY ("company_id","grant_receipt_id") REFERENCES "public"."trust_document_access_grants"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trust_document_access_grants_principal_idx" ON "trust_document_access_grants" USING btree ("company_id","registry_entry_id","grantee_user_id","expires_at");--> statement-breakpoint
--> statement-breakpoint
CREATE FUNCTION public.aw_reject_trust_document_access_grant_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.companies WHERE id = OLD.company_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'trust document access grants are immutable' USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trust_document_access_grants_immutable
  BEFORE UPDATE OR DELETE ON public.trust_document_access_grants
  FOR EACH ROW EXECUTE FUNCTION public.aw_reject_trust_document_access_grant_mutation();
--> statement-breakpoint
CREATE FUNCTION public.aw_reject_trust_document_access_revocation_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.companies WHERE id = OLD.company_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'trust document access revocations are immutable' USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trust_document_access_revocations_immutable
  BEFORE UPDATE OR DELETE ON public.trust_document_access_revocations
  FOR EACH ROW EXECUTE FUNCTION public.aw_reject_trust_document_access_revocation_mutation();
