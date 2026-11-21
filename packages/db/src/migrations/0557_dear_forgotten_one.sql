CREATE TABLE "trust_document_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"registry_entry_id" uuid NOT NULL,
	"document_revision_id" uuid NOT NULL,
	"principal_user_id" text NOT NULL,
	"document_version" text NOT NULL,
	"request_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"surface" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trust_document_acceptances_idempotency_uq" UNIQUE("company_id","principal_user_id","request_id"),
	CONSTRAINT "trust_document_acceptances_hash_ck" CHECK ("trust_document_acceptances"."request_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "trust_document_acceptances_version_ck" CHECK (length(btrim("trust_document_acceptances"."document_version")) between 1 and 128),
	CONSTRAINT "trust_document_acceptances_surface_ck" CHECK (length(btrim("trust_document_acceptances"."surface")) between 1 and 128)
);
--> statement-breakpoint
CREATE TABLE "trust_document_registry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"document_revision_id" uuid NOT NULL,
	"owner" text NOT NULL,
	"version" text NOT NULL,
	"effective_at" timestamp with time zone,
	"evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"customer_visibility" text NOT NULL,
	"nda_required" boolean DEFAULT false NOT NULL,
	"last_reviewed_at" timestamp with time zone,
	"next_review_or_trigger" text,
	"expires_at" timestamp with time zone,
	"superseded_by" uuid,
	"acceptance_required" boolean DEFAULT false NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trust_document_registry_company_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "trust_document_registry_revision_uq" UNIQUE("company_id","document_revision_id"),
	CONSTRAINT "trust_document_registry_version_ck" CHECK (length(btrim("trust_document_registry"."version")) between 1 and 128),
	CONSTRAINT "trust_document_registry_owner_ck" CHECK (length(btrim("trust_document_registry"."owner")) between 1 and 300),
	CONSTRAINT "trust_document_registry_visibility_ck" CHECK ("trust_document_registry"."customer_visibility" in ('public','gated','internal')),
	CONSTRAINT "trust_document_registry_evidence_refs_ck" CHECK (jsonb_typeof("trust_document_registry"."evidence_refs")='array' and jsonb_array_length("trust_document_registry"."evidence_refs")<=100),
	CONSTRAINT "trust_document_registry_superseded_self_ck" CHECK ("trust_document_registry"."superseded_by" is null or "trust_document_registry"."superseded_by" <> "trust_document_registry"."id")
);
--> statement-breakpoint
ALTER TABLE "trust_document_acceptances" ADD CONSTRAINT "trust_document_acceptances_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_document_registry" ADD CONSTRAINT "trust_document_registry_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_document_registry" ADD CONSTRAINT "trust_document_registry_revision_fk" FOREIGN KEY ("company_id","document_id","document_revision_id") REFERENCES "public"."document_revisions"("company_id","document_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_document_registry" ADD CONSTRAINT "trust_document_registry_superseded_fk" FOREIGN KEY ("company_id","superseded_by") REFERENCES "public"."trust_document_registry"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trust_document_acceptances_principal_idx" ON "trust_document_acceptances" USING btree ("company_id","principal_user_id","accepted_at");--> statement-breakpoint
CREATE INDEX "trust_document_registry_company_current_idx" ON "trust_document_registry" USING btree ("company_id","document_id","created_at");
--> statement-breakpoint
CREATE FUNCTION public.aw_reject_trust_document_acceptance_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.companies WHERE id = OLD.company_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'trust document acceptance receipts are immutable' USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trust_document_acceptances_immutable
  BEFORE UPDATE OR DELETE ON public.trust_document_acceptances
  FOR EACH ROW EXECUTE FUNCTION public.aw_reject_trust_document_acceptance_mutation();
