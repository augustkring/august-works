CREATE TABLE "trust_document_action_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"registry_entry_id" uuid NOT NULL,
	"document_revision_id" uuid NOT NULL,
	"principal_user_id" text NOT NULL,
	"document_version" text NOT NULL,
	"action" text NOT NULL,
	"request_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"surface" text NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trust_document_action_receipts_idempotency_uq" UNIQUE("company_id","principal_user_id","request_id"),
	CONSTRAINT "trust_document_action_receipts_action_ck" CHECK ("trust_document_action_receipts"."action" in ('notice_read','customer_admin_acknowledgment')),
	CONSTRAINT "trust_document_action_receipts_hash_ck" CHECK ("trust_document_action_receipts"."request_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "trust_document_action_receipts_version_ck" CHECK (length(btrim("trust_document_action_receipts"."document_version")) between 1 and 128),
	CONSTRAINT "trust_document_action_receipts_surface_ck" CHECK (length(btrim("trust_document_action_receipts"."surface")) between 1 and 128)
);
--> statement-breakpoint
ALTER TABLE "trust_document_registry" ADD COLUMN "material_change_action" text DEFAULT 'no_action' NOT NULL;--> statement-breakpoint
UPDATE "trust_document_registry" SET "material_change_action" = 'reacceptance' WHERE "acceptance_required" = true;--> statement-breakpoint
ALTER TABLE "trust_document_action_receipts" ADD CONSTRAINT "trust_document_action_receipts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_document_action_receipts" ADD CONSTRAINT "trust_document_action_receipts_registry_fk" FOREIGN KEY ("company_id","registry_entry_id") REFERENCES "public"."trust_document_registry"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trust_document_action_receipts_current_idx" ON "trust_document_action_receipts" USING btree ("company_id","registry_entry_id","action","completed_at");--> statement-breakpoint
ALTER TABLE "trust_document_registry" ADD CONSTRAINT "trust_document_registry_material_action_ck" CHECK ("trust_document_registry"."material_change_action" in ('notice','reacceptance','customer_admin_acknowledgment','no_action'));--> statement-breakpoint
ALTER TABLE "trust_document_registry" ADD CONSTRAINT "trust_document_registry_acceptance_action_ck" CHECK ("trust_document_registry"."acceptance_required" = ("trust_document_registry"."material_change_action" = 'reacceptance'));
--> statement-breakpoint
CREATE FUNCTION public.aw_reject_trust_document_action_receipt_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.companies WHERE id = OLD.company_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'trust document action receipts are immutable' USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trust_document_action_receipts_immutable
  BEFORE UPDATE OR DELETE ON public.trust_document_action_receipts
  FOR EACH ROW EXECUTE FUNCTION public.aw_reject_trust_document_action_receipt_mutation();
--> statement-breakpoint
CREATE FUNCTION public.aw_reject_trust_document_registry_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.companies WHERE id = OLD.company_id) THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.superseded_by IS NULL AND NEW.superseded_by IS NOT NULL
     AND (to_jsonb(NEW) - 'superseded_by') = (to_jsonb(OLD) - 'superseded_by') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'trust document registry entries are immutable except for one-way supersession' USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trust_document_registry_immutable
  BEFORE UPDATE OR DELETE ON public.trust_document_registry
  FOR EACH ROW EXECUTE FUNCTION public.aw_reject_trust_document_registry_mutation();
