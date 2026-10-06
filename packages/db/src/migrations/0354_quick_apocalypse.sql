CREATE TABLE "memory_model_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"model_id" uuid NOT NULL,
	"model_version" integer NOT NULL,
	"memory_record_id" uuid NOT NULL,
	"observation_id" uuid,
	"observation_version" integer,
	"source_version" text NOT NULL,
	"relationship" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_evidence_observation_check" CHECK (("memory_model_evidence"."observation_id" is null) = ("memory_model_evidence"."observation_version" is null))
);
--> statement-breakpoint
CREATE TABLE "memory_model_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"model_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content" text NOT NULL,
	"source_watermark" text NOT NULL,
	"erased_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_versions_company_model_version_uq" UNIQUE("company_id","model_id","version")
);
--> statement-breakpoint
CREATE TABLE "memory_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"model_key" text NOT NULL,
	"name" text NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" text,
	"purpose" text NOT NULL,
	"source_query" text NOT NULL,
	"content" text NOT NULL,
	"status" text DEFAULT 'candidate' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"confidence" double precision NOT NULL,
	"sensitivity" text NOT NULL,
	"source_watermark" text NOT NULL,
	"reviewed_by_user_id" text,
	"reviewed_at" timestamp with time zone,
	"last_rebuilt_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"erased_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "models_company_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "models_company_key_uq" UNIQUE("company_id","model_key"),
	CONSTRAINT "models_scope_check" CHECK (("memory_models"."scope_type"='company' and "memory_models"."scope_id" is null) or ("memory_models"."scope_type" in ('project','subject') and "memory_models"."scope_id" is not null)),
	CONSTRAINT "models_status_check" CHECK ("memory_models"."status" in ('candidate','active','needs_rebuild','degraded','superseded','revoked')),
	CONSTRAINT "models_confidence_check" CHECK ("memory_models"."confidence" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE "memory_observation_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"observation_id" uuid NOT NULL,
	"memory_record_id" uuid NOT NULL,
	"source_version" text NOT NULL,
	"relationship" text NOT NULL,
	"root_fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "observation_evidence_root_uq" UNIQUE("observation_id","memory_record_id"),
	CONSTRAINT "observation_evidence_relation_check" CHECK ("memory_observation_evidence"."relationship" in ('supports','contradicts','context'))
);
--> statement-breakpoint
CREATE TABLE "memory_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"observation_key" text NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" text,
	"purpose" text NOT NULL,
	"content" text NOT NULL,
	"status" text DEFAULT 'candidate' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"confidence" double precision NOT NULL,
	"sensitivity" text NOT NULL,
	"support_count" integer NOT NULL,
	"contradiction_count" integer NOT NULL,
	"independent_source_count" integer NOT NULL,
	"reviewed_by_user_id" text,
	"reviewed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"erased_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "observations_company_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "observations_scope_check" CHECK (("memory_observations"."scope_type"='company' and "memory_observations"."scope_id" is null) or ("memory_observations"."scope_type" in ('project','subject') and "memory_observations"."scope_id" is not null)),
	CONSTRAINT "observations_status_check" CHECK ("memory_observations"."status" in ('candidate','accepted','needs_review','rejected','superseded','revoked','expired')),
	CONSTRAINT "observations_confidence_check" CHECK ("memory_observations"."confidence" between 0 and 1)
);
--> statement-breakpoint
ALTER TABLE "memory_jobs" DROP CONSTRAINT "memory_jobs_operation_type_check";--> statement-breakpoint
ALTER TABLE "memory_model_evidence" ADD CONSTRAINT "memory_model_evidence_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_model_evidence" ADD CONSTRAINT "model_evidence_version_fk" FOREIGN KEY ("company_id","model_id","model_version") REFERENCES "public"."memory_model_versions"("company_id","model_id","version") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_model_evidence" ADD CONSTRAINT "model_evidence_memory_fk" FOREIGN KEY ("company_id","memory_record_id") REFERENCES "public"."memory_records"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_model_evidence" ADD CONSTRAINT "model_evidence_observation_fk" FOREIGN KEY ("company_id","observation_id") REFERENCES "public"."memory_observations"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_model_versions" ADD CONSTRAINT "memory_model_versions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_model_versions" ADD CONSTRAINT "model_versions_model_fk" FOREIGN KEY ("company_id","model_id") REFERENCES "public"."memory_models"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_models" ADD CONSTRAINT "memory_models_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_observation_evidence" ADD CONSTRAINT "memory_observation_evidence_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_observation_evidence" ADD CONSTRAINT "observation_evidence_observation_fk" FOREIGN KEY ("company_id","observation_id") REFERENCES "public"."memory_observations"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_observation_evidence" ADD CONSTRAINT "observation_evidence_memory_fk" FOREIGN KEY ("company_id","memory_record_id") REFERENCES "public"."memory_records"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_observations" ADD CONSTRAINT "memory_observations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "models_company_status_idx" ON "memory_models" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "observations_company_status_idx" ON "memory_observations" USING btree ("company_id","status");--> statement-breakpoint
ALTER TABLE "memory_jobs" ADD CONSTRAINT "memory_jobs_operation_type_check" CHECK ("memory_jobs"."operation_type" in ('capture','dedupe','compaction','reflection','index_refresh','retention','model_rebuild'));