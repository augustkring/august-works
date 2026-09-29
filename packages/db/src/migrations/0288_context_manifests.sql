CREATE TABLE "context_manifests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "run_id" uuid,
  "agent_id" uuid NOT NULL,
  "issue_id" uuid,
  "project_id" uuid,
  "query_hash" text NOT NULL,
  "policy_snapshot_hash" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "context_manifests_query_hash_check" CHECK ("context_manifests"."query_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "context_manifests_policy_snapshot_hash_check" CHECK ("context_manifests"."policy_snapshot_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "context_manifest_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "manifest_id" uuid NOT NULL,
  "source_class" text NOT NULL,
  "source_provider" text NOT NULL,
  "source_ref" text NOT NULL,
  "source_version" text,
  "content_hash" text NOT NULL,
  "authority_domain" text,
  "trust_level" text NOT NULL,
  "sensitivity" text NOT NULL,
  "rank" integer NOT NULL,
  "selection_reason" text NOT NULL,
  "retrieval_score" double precision,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "context_manifest_items_source_class_check" CHECK ("context_manifest_items"."source_class" in ('foundation', 'system_of_record', 'accepted_memory', 'private_memory', 'task', 'artifact', 'conversation', 'external_untrusted')),
  CONSTRAINT "context_manifest_items_trust_level_check" CHECK ("context_manifest_items"."trust_level" in ('high', 'medium', 'low', 'untrusted')),
  CONSTRAINT "context_manifest_items_sensitivity_check" CHECK ("context_manifest_items"."sensitivity" in ('public', 'internal', 'confidential', 'restricted')),
  CONSTRAINT "context_manifest_items_rank_check" CHECK ("context_manifest_items"."rank" >= 0),
  CONSTRAINT "context_manifest_items_content_hash_check" CHECK ("context_manifest_items"."content_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "context_manifests" ADD CONSTRAINT "context_manifests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "context_manifest_items" ADD CONSTRAINT "context_manifest_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "context_manifests_company_id_id_uq" ON "context_manifests" USING btree ("company_id","id");
--> statement-breakpoint
ALTER TABLE "context_manifest_items" ADD CONSTRAINT "context_manifest_items_company_manifest_fk" FOREIGN KEY ("company_id","manifest_id") REFERENCES "public"."context_manifests"("company_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "context_manifests_company_run_created_idx" ON "context_manifests" USING btree ("company_id","run_id","created_at");
--> statement-breakpoint
CREATE INDEX "context_manifests_company_agent_created_idx" ON "context_manifests" USING btree ("company_id","agent_id","created_at");
--> statement-breakpoint
CREATE INDEX "context_manifests_company_issue_created_idx" ON "context_manifests" USING btree ("company_id","issue_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "context_manifest_items_manifest_rank_uq" ON "context_manifest_items" USING btree ("manifest_id","rank");
--> statement-breakpoint
CREATE INDEX "context_manifest_items_company_manifest_idx" ON "context_manifest_items" USING btree ("company_id","manifest_id");
--> statement-breakpoint
CREATE INDEX "context_manifest_items_company_source_idx" ON "context_manifest_items" USING btree ("company_id","source_provider","source_ref");
