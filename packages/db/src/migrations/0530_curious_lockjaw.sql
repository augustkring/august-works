CREATE TABLE "memory_private_share_publications" (
	"company_id" uuid NOT NULL,
	"shared_record_id" uuid NOT NULL,
	"source_record_id" uuid NOT NULL,
	"source_owner_user_id" text,
	"target_binding_id" uuid NOT NULL,
	"target_scope_type" text NOT NULL,
	"target_scope_id" text,
	"source_version" text NOT NULL,
	"source_fingerprint" text NOT NULL,
	"shared_fingerprint" text NOT NULL,
	"operation_fingerprint" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"proposed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"published_by_user_id" text,
	CONSTRAINT "memory_private_share_publications_pk" PRIMARY KEY("company_id","shared_record_id"),
	CONSTRAINT "memory_private_share_publications_state_check" CHECK ("memory_private_share_publications"."state" in ('pending','published','rejected')),
	CONSTRAINT "memory_private_share_publications_scope_check" CHECK (("memory_private_share_publications"."target_scope_type" = 'company' and "memory_private_share_publications"."target_scope_id" is null) or ("memory_private_share_publications"."target_scope_type" in ('project','subject') and "memory_private_share_publications"."target_scope_id" is not null)),
	CONSTRAINT "memory_private_share_publications_fingerprint_check" CHECK ("memory_private_share_publications"."source_fingerprint" ~ '^[0-9a-f]{64}$' and "memory_private_share_publications"."shared_fingerprint" ~ '^[0-9a-f]{64}$' and "memory_private_share_publications"."operation_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "memory_private_share_publications_distinct_records_check" CHECK ("memory_private_share_publications"."source_record_id" <> "memory_private_share_publications"."shared_record_id"),
	CONSTRAINT "memory_private_share_publications_published_check" CHECK (("memory_private_share_publications"."state" = 'published' and "memory_private_share_publications"."published_at" is not null and "memory_private_share_publications"."published_by_user_id" is not null
        and "memory_private_share_publications"."source_owner_user_id" is not null and "memory_private_share_publications"."published_by_user_id" = "memory_private_share_publications"."source_owner_user_id")
      or ("memory_private_share_publications"."state" <> 'published' and "memory_private_share_publications"."published_at" is null and "memory_private_share_publications"."published_by_user_id" is null))
);
--> statement-breakpoint
ALTER TABLE "memory_private_share_publications" ADD CONSTRAINT "memory_private_share_publications_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_private_share_publications" ADD CONSTRAINT "memory_private_share_publications_source_fk" FOREIGN KEY ("company_id","source_record_id") REFERENCES "public"."memory_records"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_private_share_publications" ADD CONSTRAINT "memory_private_share_publications_shared_fk" FOREIGN KEY ("company_id","shared_record_id") REFERENCES "public"."memory_records"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_private_share_publications" ADD CONSTRAINT "memory_private_share_publications_binding_fk" FOREIGN KEY ("company_id","target_binding_id") REFERENCES "public"."memory_bindings"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "memory_private_share_publications_operation_uq" ON "memory_private_share_publications" USING btree ("company_id","operation_fingerprint");--> statement-breakpoint
CREATE INDEX "memory_private_share_publications_source_idx" ON "memory_private_share_publications" USING btree ("company_id","source_record_id");