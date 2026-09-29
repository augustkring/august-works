CREATE TABLE "foundation_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "document_id" uuid NOT NULL,
  "approved_revision_id" uuid,
  "foundation_key" text NOT NULL,
  "category" text NOT NULL,
  "document_type" text NOT NULL,
  "authority_level" text DEFAULT 'canonical' NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "sensitivity" text DEFAULT 'internal' NOT NULL,
  "draft_metadata" jsonb,
  "owner_user_id" text,
  "owner_agent_id" uuid,
  "review_frequency_days" integer,
  "last_reviewed_at" timestamp with time zone,
  "next_review_at" timestamp with time zone,
  "valid_from" timestamp with time zone,
  "valid_until" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "foundation_documents_status_check" CHECK ("foundation_documents"."status" in ('draft', 'in_review', 'approved', 'superseded', 'archived')),
  CONSTRAINT "foundation_documents_authority_check" CHECK ("foundation_documents"."authority_level" in ('canonical', 'supporting')),
  CONSTRAINT "foundation_documents_sensitivity_check" CHECK ("foundation_documents"."sensitivity" in ('public', 'internal', 'confidential', 'restricted')),
  CONSTRAINT "foundation_documents_review_frequency_check" CHECK ("foundation_documents"."review_frequency_days" is null or "foundation_documents"."review_frequency_days" > 0),
  CONSTRAINT "foundation_documents_validity_check" CHECK ("foundation_documents"."valid_until" is null or "foundation_documents"."valid_from" is null or "foundation_documents"."valid_until" > "foundation_documents"."valid_from"),
  CONSTRAINT "foundation_documents_approved_pointer_check" CHECK ("foundation_documents"."status" <> 'approved' or "foundation_documents"."approved_revision_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "foundation_sections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "foundation_document_id" uuid NOT NULL,
  "document_revision_id" uuid NOT NULL,
  "heading_path" text[] NOT NULL,
  "ordinal" integer NOT NULL,
  "body" text NOT NULL,
  "content_hash" text NOT NULL,
  "token_count" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "foundation_sections_token_count_check" CHECK ("foundation_sections"."token_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "foundation_change_proposals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "foundation_document_id" uuid NOT NULL,
  "source_type" text NOT NULL,
  "source_id" text,
  "proposed_by_agent_id" uuid,
  "proposed_by_user_id" text,
  "base_revision_id" uuid,
  "proposed_body" text NOT NULL,
  "change_summary" text,
  "reason" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "reviewed_by_user_id" text,
  "reviewed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "foundation_change_proposals_status_check" CHECK ("foundation_change_proposals"."status" in ('pending', 'accepted', 'rejected', 'superseded'))
);
--> statement-breakpoint
ALTER TABLE "foundation_documents" ADD CONSTRAINT "foundation_documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "foundation_documents" ADD CONSTRAINT "foundation_documents_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "foundation_documents" ADD CONSTRAINT "foundation_documents_approved_revision_id_document_revisions_id_fk" FOREIGN KEY ("approved_revision_id") REFERENCES "public"."document_revisions"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "foundation_documents" ADD CONSTRAINT "foundation_documents_owner_agent_id_agents_id_fk" FOREIGN KEY ("owner_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "foundation_sections" ADD CONSTRAINT "foundation_sections_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "foundation_sections" ADD CONSTRAINT "foundation_sections_foundation_document_id_foundation_documents_id_fk" FOREIGN KEY ("foundation_document_id") REFERENCES "public"."foundation_documents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "foundation_sections" ADD CONSTRAINT "foundation_sections_document_revision_id_document_revisions_id_fk" FOREIGN KEY ("document_revision_id") REFERENCES "public"."document_revisions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "foundation_change_proposals" ADD CONSTRAINT "foundation_change_proposals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "foundation_change_proposals" ADD CONSTRAINT "foundation_change_proposals_foundation_document_id_foundation_documents_id_fk" FOREIGN KEY ("foundation_document_id") REFERENCES "public"."foundation_documents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "foundation_change_proposals" ADD CONSTRAINT "foundation_change_proposals_proposed_by_agent_id_agents_id_fk" FOREIGN KEY ("proposed_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "foundation_change_proposals" ADD CONSTRAINT "foundation_change_proposals_base_revision_id_document_revisions_id_fk" FOREIGN KEY ("base_revision_id") REFERENCES "public"."document_revisions"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "foundation_documents_company_key_uq" ON "foundation_documents" USING btree ("company_id","foundation_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "foundation_documents_company_document_uq" ON "foundation_documents" USING btree ("company_id","document_id");
--> statement-breakpoint
CREATE INDEX "foundation_documents_company_category_status_idx" ON "foundation_documents" USING btree ("company_id","category","status");
--> statement-breakpoint
CREATE INDEX "foundation_documents_company_status_updated_idx" ON "foundation_documents" USING btree ("company_id","status","updated_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "foundation_sections_revision_ordinal_uq" ON "foundation_sections" USING btree ("foundation_document_id","document_revision_id","ordinal");
--> statement-breakpoint
CREATE INDEX "foundation_sections_company_document_revision_idx" ON "foundation_sections" USING btree ("company_id","foundation_document_id","document_revision_id");
--> statement-breakpoint
CREATE INDEX "foundation_change_proposals_company_status_created_idx" ON "foundation_change_proposals" USING btree ("company_id","status","created_at");
--> statement-breakpoint
CREATE INDEX "foundation_change_proposals_document_status_idx" ON "foundation_change_proposals" USING btree ("foundation_document_id","status");
