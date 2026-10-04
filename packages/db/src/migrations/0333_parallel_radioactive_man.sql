CREATE TABLE "playbook_change_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"playbook_id" uuid NOT NULL,
	"base_approved_revision_id" uuid,
	"title" text NOT NULL,
	"markdown" text NOT NULL,
	"reason" text NOT NULL,
	"source_skill_id" uuid,
	"source_skill_version_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_by_user_id" text,
	"created_by_agent_id" uuid,
	"reviewed_by_user_id" text,
	"review_rationale" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "playbook_change_proposals_state_check" CHECK ("playbook_change_proposals"."status" in ('pending','accepted','rejected','stale'))
);
--> statement-breakpoint
CREATE TABLE "playbook_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"playbook_key" text NOT NULL,
	"category" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"sensitivity" text DEFAULT 'internal' NOT NULL,
	"approved_revision_id" uuid,
	"owner_user_id" text,
	"owner_agent_id" uuid,
	"review_frequency_days" integer DEFAULT 90 NOT NULL,
	"last_reviewed_at" timestamp with time zone,
	"next_review_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "playbook_documents_company_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "playbook_documents_company_key_uq" UNIQUE("company_id","playbook_key"),
	CONSTRAINT "playbook_documents_company_document_uq" UNIQUE("company_id","document_id"),
	CONSTRAINT "playbook_documents_state_check" CHECK ("playbook_documents"."status" in ('draft','in_review','approved','superseded','archived')),
	CONSTRAINT "playbook_documents_approved_check" CHECK ("playbook_documents"."status" <> 'approved' or "playbook_documents"."approved_revision_id" is not null),
	CONSTRAINT "playbook_documents_sensitivity_check" CHECK ("playbook_documents"."sensitivity" in ('public','internal','confidential','restricted')),
	CONSTRAINT "playbook_documents_review_check" CHECK ("playbook_documents"."review_frequency_days" between 1 and 3650)
);
--> statement-breakpoint
CREATE TABLE "playbook_skill_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"playbook_id" uuid NOT NULL,
	"playbook_revision_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"skill_version_id" uuid NOT NULL,
	"relation_type" text NOT NULL,
	"sync_policy" text DEFAULT 'notify_on_change' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "playbook_skill_links_version_uq" UNIQUE("company_id","playbook_id","playbook_revision_id","skill_version_id","relation_type"),
	CONSTRAINT "playbook_skill_links_relation_check" CHECK ("playbook_skill_links"."relation_type" in ('implements','refers_to','derived_from')),
	CONSTRAINT "playbook_skill_links_sync_check" CHECK ("playbook_skill_links"."sync_policy" in ('manual','notify_on_change','auto_generate_candidate'))
);
--> statement-breakpoint
ALTER TABLE "document_revisions" ADD CONSTRAINT "document_revisions_company_document_id_uq" UNIQUE("company_id","document_id","id");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_company_id_uq" UNIQUE("company_id","id");--> statement-breakpoint
ALTER TABLE "playbook_change_proposals" ADD CONSTRAINT "playbook_change_proposals_company_id_playbook_id_playbook_documents_company_id_id_fk" FOREIGN KEY ("company_id","playbook_id") REFERENCES "public"."playbook_documents"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_change_proposals" ADD CONSTRAINT "playbook_change_proposals_company_id_source_skill_id_source_skill_version_id_company_skill_versions_company_id_company_skill_id_id_fk" FOREIGN KEY ("company_id","source_skill_id","source_skill_version_id") REFERENCES "public"."company_skill_versions"("company_id","company_skill_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_change_proposals" ADD CONSTRAINT "playbook_change_proposals_company_id_created_by_agent_id_agents_company_id_id_fk" FOREIGN KEY ("company_id","created_by_agent_id") REFERENCES "public"."agents"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_documents" ADD CONSTRAINT "playbook_documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_documents" ADD CONSTRAINT "playbook_documents_company_id_document_id_documents_company_id_id_fk" FOREIGN KEY ("company_id","document_id") REFERENCES "public"."documents"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_documents" ADD CONSTRAINT "playbook_documents_company_id_document_id_approved_revision_id_document_revisions_company_id_document_id_id_fk" FOREIGN KEY ("company_id","document_id","approved_revision_id") REFERENCES "public"."document_revisions"("company_id","document_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_documents" ADD CONSTRAINT "playbook_documents_company_id_owner_agent_id_agents_company_id_id_fk" FOREIGN KEY ("company_id","owner_agent_id") REFERENCES "public"."agents"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_skill_links" ADD CONSTRAINT "playbook_skill_links_company_id_playbook_id_playbook_documents_company_id_id_fk" FOREIGN KEY ("company_id","playbook_id") REFERENCES "public"."playbook_documents"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_skill_links" ADD CONSTRAINT "playbook_skill_links_company_id_skill_id_skill_version_id_company_skill_versions_company_id_company_skill_id_id_fk" FOREIGN KEY ("company_id","skill_id","skill_version_id") REFERENCES "public"."company_skill_versions"("company_id","company_skill_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "playbook_change_proposals_status_idx" ON "playbook_change_proposals" USING btree ("company_id","playbook_id","status");--> statement-breakpoint
CREATE INDEX "playbook_documents_status_idx" ON "playbook_documents" USING btree ("company_id","status");