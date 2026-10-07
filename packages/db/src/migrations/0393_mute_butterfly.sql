CREATE TABLE "process_analysis_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"definition_key" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_version_id" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "process_definitions_tenant_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "process_definitions_key_uq" UNIQUE("company_id","definition_key"),
	CONSTRAINT "process_definitions_state_check" CHECK ("process_analysis_definitions"."revision">0 and "process_analysis_definitions"."status" in ('draft','published','retired') and ("process_analysis_definitions"."status"<>'published' or "process_analysis_definitions"."published_version_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "process_analysis_publications" (
	"company_id" uuid NOT NULL,
	"definition_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"published_by" text NOT NULL,
	"rationale" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "process_publications_version_uq" UNIQUE("company_id","definition_id","version_id")
);
--> statement-breakpoint
CREATE TABLE "process_analysis_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"definition_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"lineage_manifest_id" uuid NOT NULL,
	"definition_hash" text NOT NULL,
	"event_set_hash" text NOT NULL,
	"from_time" timestamp with time zone NOT NULL,
	"until_time" timestamp with time zone NOT NULL,
	"result_json" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "process_runs_tenant_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "process_runs_lineage_uq" UNIQUE("company_id","lineage_manifest_id"),
	CONSTRAINT "process_runs_bounds_check" CHECK ("process_analysis_runs"."definition_hash" ~ '^[0-9a-f]{64}$' and "process_analysis_runs"."event_set_hash" ~ '^[0-9a-f]{64}$' and "process_analysis_runs"."from_time"<"process_analysis_runs"."until_time" and "process_analysis_runs"."expires_at">"process_analysis_runs"."created_at" and jsonb_typeof("process_analysis_runs"."result_json")='object')
);
--> statement-breakpoint
CREATE TABLE "process_analysis_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"definition_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"definition_json" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"next_review_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "process_versions_tenant_id_uq" UNIQUE("company_id","definition_id","id"),
	CONSTRAINT "process_versions_revision_uq" UNIQUE("company_id","definition_id","revision"),
	CONSTRAINT "process_versions_definition_check" CHECK ("process_analysis_versions"."revision">0 and "process_analysis_versions"."content_hash" ~ '^[0-9a-f]{64}$' and jsonb_typeof("process_analysis_versions"."definition_json")='object' and "process_analysis_versions"."next_review_at">"process_analysis_versions"."created_at" and "process_analysis_versions"."expires_at">"process_analysis_versions"."created_at")
);
--> statement-breakpoint
ALTER TABLE "process_analysis_definitions" ADD CONSTRAINT "process_analysis_definitions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_analysis_definitions" ADD CONSTRAINT "process_definitions_published_fk" FOREIGN KEY ("company_id","id","published_version_id") REFERENCES "public"."process_analysis_versions"("company_id","definition_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_analysis_publications" ADD CONSTRAINT "process_publications_version_fk" FOREIGN KEY ("company_id","definition_id","version_id") REFERENCES "public"."process_analysis_versions"("company_id","definition_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_analysis_runs" ADD CONSTRAINT "process_runs_version_fk" FOREIGN KEY ("company_id","definition_id","version_id") REFERENCES "public"."process_analysis_versions"("company_id","definition_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_analysis_runs" ADD CONSTRAINT "process_runs_lineage_fk" FOREIGN KEY ("company_id","lineage_manifest_id") REFERENCES "public"."analytical_lineage_manifests"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_analysis_versions" ADD CONSTRAINT "process_versions_definition_fk" FOREIGN KEY ("company_id","definition_id") REFERENCES "public"."process_analysis_definitions"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "process_runs_company_time_idx" ON "process_analysis_runs" USING btree ("company_id","created_at","id");
--> statement-breakpoint
CREATE TRIGGER aw_process_version_immutable BEFORE UPDATE ON process_analysis_versions FOR EACH ROW EXECUTE FUNCTION aw_analytical_snapshot_immutable();
--> statement-breakpoint
CREATE TRIGGER aw_process_publication_immutable BEFORE UPDATE ON process_analysis_publications FOR EACH ROW EXECUTE FUNCTION aw_analytical_snapshot_immutable();
--> statement-breakpoint
CREATE TRIGGER aw_process_run_immutable BEFORE UPDATE ON process_analysis_runs FOR EACH ROW EXECUTE FUNCTION aw_analytical_snapshot_immutable();
--> statement-breakpoint
CREATE FUNCTION aw_process_run_admission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM process_analysis_definitions d
  JOIN process_analysis_versions v ON v.company_id=d.company_id AND v.definition_id=d.id AND v.id=NEW.version_id
  JOIN process_analysis_publications p ON p.company_id=v.company_id AND p.definition_id=v.definition_id AND p.version_id=v.id
  JOIN analytical_lineage_manifests m ON m.company_id=NEW.company_id AND m.id=NEW.lineage_manifest_id
  WHERE d.company_id=NEW.company_id AND d.id=NEW.definition_id AND d.status='published' AND d.published_version_id=v.id
   AND v.content_hash=NEW.definition_hash AND v.expires_at>NEW.created_at AND v.next_review_at>NEW.created_at
   AND m.analysis_type='process_analysis' AND m.analysis_ref=NEW.id AND m.definition_hash=NEW.definition_hash AND m.input_hash=NEW.event_set_hash
   AND m.created_at=NEW.created_at AND m.expires_at=NEW.expires_at AND NEW.expires_at<=v.expires_at
   AND (m.parameters_json->>'from')::timestamptz=NEW.from_time AND (m.parameters_json->>'until')::timestamptz=NEW.until_time
   AND NEW.result_json->>'engineVersion'=m.engine_version
   AND NEW.result_json->'readiness'->>'eventSetHash'=NEW.event_set_hash
   AND NEW.result_json->'readiness'->>'companyId'=NEW.company_id::text
   AND NEW.result_json->>'semantics'='observed_native_activity_paths_no_causal_or_person_effect') THEN
  RAISE EXCEPTION 'Process run lacks matching native publication and lineage' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER aw_process_run_admission BEFORE INSERT ON process_analysis_runs FOR EACH ROW EXECUTE FUNCTION aw_process_run_admission();
