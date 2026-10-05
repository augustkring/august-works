CREATE TABLE "application_storage_objects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"billing_account_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"status" text DEFAULT 'reserved' NOT NULL,
	"stored_at" timestamp with time zone,
	"metered_through" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"last_observed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "application_storage_objects_scope_ck" CHECK (left("application_storage_objects"."object_key",37) = "application_storage_objects"."company_id"::text || '/'),
	CONSTRAINT "application_storage_objects_size_ck" CHECK ("application_storage_objects"."byte_size" > 0),
	CONSTRAINT "application_storage_objects_status_ck" CHECK ("application_storage_objects"."status" in ('reserved','present','deleting','deleted'))
);
--> statement-breakpoint
ALTER TABLE "application_storage_objects" ADD CONSTRAINT "application_storage_objects_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_storage_objects" ADD CONSTRAINT "application_storage_objects_billing_account_id_billing_accounts_id_fk" FOREIGN KEY ("billing_account_id") REFERENCES "public"."billing_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_storage_objects" ADD CONSTRAINT "application_storage_objects_company_id_billing_account_id_billing_account_companies_company_id_billing_account_id_fk" FOREIGN KEY ("company_id","billing_account_id") REFERENCES "public"."billing_account_companies"("company_id","billing_account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "application_storage_objects_key_uq" ON "application_storage_objects" USING btree ("company_id","object_key");--> statement-breakpoint
CREATE INDEX "application_storage_objects_account_idx" ON "application_storage_objects" USING btree ("billing_account_id","status");--> statement-breakpoint
CREATE INDEX "application_storage_objects_observation_idx" ON "application_storage_objects" USING btree ("last_observed_at");