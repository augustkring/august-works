CREATE TABLE "company_relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_company_id" uuid NOT NULL,
	"target_company_id" uuid NOT NULL,
	"relationship_type" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"accepted_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_relationships_source_target_type_uq" UNIQUE("source_company_id","target_company_id","relationship_type"),
	CONSTRAINT "company_relationships_different_companies" CHECK ("company_relationships"."source_company_id" <> "company_relationships"."target_company_id"),
	CONSTRAINT "company_relationships_status_check" CHECK ("company_relationships"."status" in ('proposed', 'active', 'rejected', 'revoked'))
);
--> statement-breakpoint
CREATE TABLE "org_unit_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"org_unit_id" uuid NOT NULL,
	"principal_type" text NOT NULL,
	"principal_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_unit_memberships_unit_principal_uq" UNIQUE("org_unit_id","principal_type","principal_id"),
	CONSTRAINT "org_unit_memberships_principal_type_check" CHECK ("org_unit_memberships"."principal_type" in ('user', 'agent')),
	CONSTRAINT "org_unit_memberships_status_check" CHECK ("org_unit_memberships"."status" in ('active', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "org_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"type" text DEFAULT 'team' NOT NULL,
	"parent_id" uuid,
	"lead_user_id" text,
	"lead_agent_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_units_company_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "org_units_company_slug_uq" UNIQUE("company_id","slug"),
	CONSTRAINT "org_units_parent_check" CHECK ("org_units"."parent_id" is null or "org_units"."parent_id" <> "org_units"."id"),
	CONSTRAINT "org_units_status_check" CHECK ("org_units"."status" in ('active', 'archived'))
);
--> statement-breakpoint
ALTER TABLE "company_relationships" ADD CONSTRAINT "company_relationships_source_company_id_companies_id_fk" FOREIGN KEY ("source_company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_relationships" ADD CONSTRAINT "company_relationships_target_company_id_companies_id_fk" FOREIGN KEY ("target_company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_unit_memberships" ADD CONSTRAINT "org_unit_memberships_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_unit_memberships" ADD CONSTRAINT "org_unit_memberships_company_id_org_unit_id_org_units_company_id_id_fk" FOREIGN KEY ("company_id","org_unit_id") REFERENCES "public"."org_units"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_parent_id_org_units_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_company_id_parent_id_org_units_company_id_id_fk" FOREIGN KEY ("company_id","parent_id") REFERENCES "public"."org_units"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_company_id_lead_agent_id_agents_company_id_id_fk" FOREIGN KEY ("company_id","lead_agent_id") REFERENCES "public"."agents"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_relationships_target_status_idx" ON "company_relationships" USING btree ("target_company_id","status");--> statement-breakpoint
CREATE INDEX "org_unit_memberships_company_principal_idx" ON "org_unit_memberships" USING btree ("company_id","principal_type","principal_id");--> statement-breakpoint
CREATE INDEX "org_units_company_status_idx" ON "org_units" USING btree ("company_id","status");