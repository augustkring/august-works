CREATE TABLE "analytical_lineage_edges" (
	"company_id" uuid NOT NULL,
	"manifest_id" uuid NOT NULL,
	"input_type" text NOT NULL,
	"input_ref" uuid NOT NULL,
	"input_hash" text NOT NULL,
	"relationship" text NOT NULL,
	CONSTRAINT "analytical_lineage_edges_input_uq" UNIQUE("company_id","manifest_id","input_type","input_ref"),
	CONSTRAINT "analytical_lineage_edges_type_check" CHECK ("analytical_lineage_edges"."input_type" in ('issue','project','metric_version','governance_obligation') and "analytical_lineage_edges"."relationship" in ('source','definition','policy')),
	CONSTRAINT "analytical_lineage_edges_hash_check" CHECK ("analytical_lineage_edges"."input_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "analytical_lineage_manifests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"analysis_type" text NOT NULL,
	"analysis_ref" uuid NOT NULL,
	"engine_version" text NOT NULL,
	"input_hash" text NOT NULL,
	"definition_hash" text NOT NULL,
	"requested_by" text NOT NULL,
	"source_watermark" text NOT NULL,
	"source_count" integer NOT NULL,
	"parameters_json" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "analytical_lineage_manifests_tenant_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "analytical_lineage_manifests_hash_check" CHECK ("analytical_lineage_manifests"."input_hash" ~ '^[0-9a-f]{64}$' and "analytical_lineage_manifests"."definition_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "analytical_lineage_manifests_expiry_check" CHECK ("analytical_lineage_manifests"."expires_at">"analytical_lineage_manifests"."created_at"),
	CONSTRAINT "analytical_lineage_manifests_count_check" CHECK ("analytical_lineage_manifests"."source_count">=0)
);
--> statement-breakpoint
CREATE TABLE "business_metric_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"metric_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"result_json" jsonb NOT NULL,
	"definition_hash" text NOT NULL,
	"input_hash" text NOT NULL,
	"lineage_manifest_id" uuid NOT NULL,
	"requested_by" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "business_metric_observations_tenant_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "business_metric_observations_hash_check" CHECK ("business_metric_observations"."definition_hash" ~ '^[0-9a-f]{64}$' and "business_metric_observations"."input_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "business_metric_observations_expiry_check" CHECK ("business_metric_observations"."expires_at">"business_metric_observations"."observed_at")
);
--> statement-breakpoint
CREATE TABLE "business_metric_publications" (
	"company_id" uuid NOT NULL,
	"metric_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"published_by" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_metric_publications_version_uq" UNIQUE("company_id","metric_id","version_id")
);
--> statement-breakpoint
CREATE TABLE "business_metric_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"metric_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"definition_json" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_metric_versions_tenant_metric_id_uq" UNIQUE("company_id","metric_id","id"),
	CONSTRAINT "business_metric_versions_tenant_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "business_metric_versions_revision_uq" UNIQUE("company_id","metric_id","revision"),
	CONSTRAINT "business_metric_versions_revision_check" CHECK ("business_metric_versions"."revision">0),
	CONSTRAINT "business_metric_versions_hash_check" CHECK ("business_metric_versions"."content_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "business_metric_versions_definition_check" CHECK (jsonb_typeof("business_metric_versions"."definition_json")='object')
);
--> statement-breakpoint
CREATE TABLE "business_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"metric_key" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_version_id" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_metrics_company_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "business_metrics_company_key_uq" UNIQUE("company_id","metric_key"),
	CONSTRAINT "business_metrics_revision_check" CHECK ("business_metrics"."revision" > 0),
	CONSTRAINT "business_metrics_status_check" CHECK ("business_metrics"."status" in ('draft','published','deprecated','revoked')),
	CONSTRAINT "business_metrics_publication_check" CHECK ("business_metrics"."status" <> 'published' or "business_metrics"."published_version_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "analytical_lineage_edges" ADD CONSTRAINT "analytical_lineage_edges_manifest_fk" FOREIGN KEY ("company_id","manifest_id") REFERENCES "public"."analytical_lineage_manifests"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytical_lineage_manifests" ADD CONSTRAINT "analytical_lineage_manifests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_metric_observations" ADD CONSTRAINT "business_metric_observations_version_fk" FOREIGN KEY ("company_id","metric_id","version_id") REFERENCES "public"."business_metric_versions"("company_id","metric_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_metric_observations" ADD CONSTRAINT "business_metric_observations_lineage_fk" FOREIGN KEY ("company_id","lineage_manifest_id") REFERENCES "public"."analytical_lineage_manifests"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_metric_publications" ADD CONSTRAINT "business_metric_publications_version_fk" FOREIGN KEY ("company_id","metric_id","version_id") REFERENCES "public"."business_metric_versions"("company_id","metric_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_metric_versions" ADD CONSTRAINT "business_metric_versions_metric_fk" FOREIGN KEY ("company_id","metric_id") REFERENCES "public"."business_metrics"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_metrics" ADD CONSTRAINT "business_metrics_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_metrics" ADD CONSTRAINT "business_metrics_published_version_fk" FOREIGN KEY ("company_id","id","published_version_id") REFERENCES "public"."business_metric_versions"("company_id","metric_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analytical_lineage_edges_source_idx" ON "analytical_lineage_edges" USING btree ("company_id","input_type","input_ref");--> statement-breakpoint
CREATE INDEX "analytical_lineage_manifests_company_time_idx" ON "analytical_lineage_manifests" USING btree ("company_id","created_at","id");--> statement-breakpoint
CREATE INDEX "business_metric_observations_company_time_idx" ON "business_metric_observations" USING btree ("company_id","observed_at","id");--> statement-breakpoint
-- Domain definitions are immutable even when the runtime connection can UPDATE.
-- Deletion is reserved for the metric/company owner's existing lifecycle.
CREATE FUNCTION aw_business_metric_version_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Business metric definition versions are immutable' USING ERRCODE='23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER aw_business_metric_version_immutable BEFORE UPDATE ON business_metric_versions
FOR EACH ROW EXECUTE FUNCTION aw_business_metric_version_immutable();
