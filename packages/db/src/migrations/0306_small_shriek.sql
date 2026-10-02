CREATE TABLE "memory_deletion_markers" (
	"company_id" uuid NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_deletion_markers_kind_check" CHECK ("memory_deletion_markers"."kind" in ('record','operation','source'))
);
--> statement-breakpoint
CREATE TABLE "memory_retention_policies" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"max_age_days" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_retention_policies_age_check" CHECK ("memory_retention_policies"."max_age_days" is null or "memory_retention_policies"."max_age_days" between 1 and 3650)
);
--> statement-breakpoint
ALTER TABLE "memory_deletion_markers" ADD CONSTRAINT "memory_deletion_markers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_retention_policies" ADD CONSTRAINT "memory_retention_policies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "memory_deletion_markers_company_key_uq" ON "memory_deletion_markers" USING btree ("company_id","key");