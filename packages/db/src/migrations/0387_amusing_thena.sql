ALTER TABLE "goals" ADD CONSTRAINT "goals_company_id_uq" UNIQUE("company_id","id");
--> statement-breakpoint
CREATE TABLE "business_metric_target_approvals" (
	"company_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"approved_by" text NOT NULL,
	"rationale" text NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_metric_target_approvals_version_uq" UNIQUE("company_id","target_id","version_id")
);
--> statement-breakpoint
CREATE TABLE "business_metric_target_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"metric_id" uuid NOT NULL,
	"metric_version_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"definition_json" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_metric_target_versions_tenant_id_uq" UNIQUE("company_id","target_id","id"),
	CONSTRAINT "business_metric_target_versions_revision_uq" UNIQUE("company_id","target_id","revision"),
	CONSTRAINT "business_metric_target_versions_hash_check" CHECK ("business_metric_target_versions"."content_hash" ~ '^[0-9a-f]{64}$' and "business_metric_target_versions"."revision">0 and jsonb_typeof("business_metric_target_versions"."definition_json")='object')
);
--> statement-breakpoint
CREATE TABLE "business_metric_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"target_key" text NOT NULL,
	"metric_id" uuid NOT NULL,
	"scope_type" text NOT NULL,
	"goal_id" uuid,
	"project_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"approved_version_id" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_metric_targets_tenant_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "business_metric_targets_key_uq" UNIQUE("company_id","target_key"),
	CONSTRAINT "business_metric_targets_revision_check" CHECK ("business_metric_targets"."revision">0),
	CONSTRAINT "business_metric_targets_status_check" CHECK ("business_metric_targets"."status" in ('draft','approved','retired') and ("business_metric_targets"."status"<>'approved' or "business_metric_targets"."approved_version_id" is not null)),
	CONSTRAINT "business_metric_targets_scope_check" CHECK (("business_metric_targets"."scope_type"='goal' and "business_metric_targets"."goal_id" is not null and "business_metric_targets"."project_id" is null) or ("business_metric_targets"."scope_type"='project' and "business_metric_targets"."project_id" is not null and "business_metric_targets"."goal_id" is null) or ("business_metric_targets"."scope_type" in ('company','portfolio') and "business_metric_targets"."goal_id" is null and "business_metric_targets"."project_id" is null))
);
--> statement-breakpoint
ALTER TABLE "business_metric_target_approvals" ADD CONSTRAINT "business_metric_target_approvals_version_fk" FOREIGN KEY ("company_id","target_id","version_id") REFERENCES "public"."business_metric_target_versions"("company_id","target_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_metric_target_versions" ADD CONSTRAINT "business_metric_target_versions_target_fk" FOREIGN KEY ("company_id","target_id") REFERENCES "public"."business_metric_targets"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_metric_target_versions" ADD CONSTRAINT "business_metric_target_versions_metric_fk" FOREIGN KEY ("company_id","metric_id","metric_version_id") REFERENCES "public"."business_metric_versions"("company_id","metric_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_metric_targets" ADD CONSTRAINT "business_metric_targets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_metric_targets" ADD CONSTRAINT "business_metric_targets_metric_fk" FOREIGN KEY ("company_id","metric_id") REFERENCES "public"."business_metrics"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_metric_targets" ADD CONSTRAINT "business_metric_targets_goal_fk" FOREIGN KEY ("company_id","goal_id") REFERENCES "public"."goals"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_metric_targets" ADD CONSTRAINT "business_metric_targets_project_fk" FOREIGN KEY ("company_id","project_id") REFERENCES "public"."projects"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_metric_targets" ADD CONSTRAINT "business_metric_targets_approved_fk" FOREIGN KEY ("company_id","id","approved_version_id") REFERENCES "public"."business_metric_target_versions"("company_id","target_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
