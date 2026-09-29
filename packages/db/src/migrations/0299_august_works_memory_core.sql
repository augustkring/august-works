CREATE TABLE "memory_bindings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "key" text NOT NULL,
  "name" text NOT NULL,
  "provider_key" text NOT NULL,
  "config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_binding_targets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "binding_id" uuid NOT NULL,
  "target_type" text NOT NULL,
  "target_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "memory_binding_targets_target_type_check" CHECK ("target_type" in ('company','agent','project'))
);
--> statement-breakpoint
CREATE TABLE "memory_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "binding_id" uuid NOT NULL,
  "provider_key" text NOT NULL,
  "memory_type" text NOT NULL,
  "scope_type" text NOT NULL,
  "scope_id" text,
  "subject_type" text,
  "subject_id" text,
  "owner_agent_id" uuid,
  "title" text,
  "content" text NOT NULL,
  "summary" text,
  "review_state" text DEFAULT 'pending' NOT NULL,
  "verification_state" text DEFAULT 'unverified' NOT NULL,
  "sensitivity_label" text DEFAULT 'internal' NOT NULL,
  "importance" integer DEFAULT 50 NOT NULL,
  "confidence_score" double precision DEFAULT 0.5 NOT NULL,
  "valid_from" timestamp with time zone,
  "valid_until" timestamp with time zone,
  "observed_at" timestamp with time zone NOT NULL,
  "retention_policy" text DEFAULT 'standard' NOT NULL,
  "expires_at" timestamp with time zone,
  "retention_state" text DEFAULT 'active' NOT NULL,
  "supersedes_record_id" uuid,
  "superseded_by_record_id" uuid,
  "revoked_at" timestamp with time zone,
  "revoked_by_actor_type" text,
  "revoked_by_actor_id" text,
  "revocation_reason" text,
  "created_by_actor_type" text NOT NULL,
  "created_by_actor_id" text NOT NULL,
  "created_by_operation_id" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  CONSTRAINT "memory_records_memory_type_check" CHECK ("memory_type" in ('fact','observation','decision_reference','preference','lesson','outcome','relationship','constraint')),
  CONSTRAINT "memory_records_scope_type_check" CHECK ("scope_type" in ('company','agent','project','subject')),
  CONSTRAINT "memory_records_scope_shape_check" CHECK (("scope_type" = 'company' and "scope_id" is null) or ("scope_type" <> 'company' and "scope_id" is not null)),
  CONSTRAINT "memory_records_private_shared_check" CHECK (("scope_type" = 'agent' and "owner_agent_id" is not null and "scope_id" = "owner_agent_id"::text) or ("scope_type" <> 'agent' and "owner_agent_id" is null)),
  CONSTRAINT "memory_records_subject_shape_check" CHECK (num_nonnulls("subject_type", "subject_id") in (0, 2)),
  CONSTRAINT "memory_records_review_state_check" CHECK ("review_state" in ('pending','accepted','rejected')),
  CONSTRAINT "memory_records_verification_state_check" CHECK ("verification_state" in ('unverified','corroborated','human_verified','system_verified')),
  CONSTRAINT "memory_records_sensitivity_check" CHECK ("sensitivity_label" in ('public','internal','confidential','restricted')),
  CONSTRAINT "memory_records_retention_state_check" CHECK ("retention_state" in ('active','expired')),
  CONSTRAINT "memory_records_importance_check" CHECK ("importance" between 0 and 100),
  CONSTRAINT "memory_records_confidence_check" CHECK ("confidence_score" between 0 and 1),
  CONSTRAINT "memory_records_validity_check" CHECK ("valid_until" is null or "valid_from" is null or "valid_until" > "valid_from"),
  CONSTRAINT "memory_records_expiry_check" CHECK ("expires_at" is null or "expires_at" > "observed_at"),
  CONSTRAINT "memory_records_revocation_check" CHECK (("revoked_at" is null and "revoked_by_actor_type" is null and "revoked_by_actor_id" is null and "revocation_reason" is null) or ("revoked_at" is not null and "revoked_by_actor_type" is not null and "revoked_by_actor_id" is not null and "revocation_reason" is not null)),
  CONSTRAINT "memory_records_created_actor_type_check" CHECK ("created_by_actor_type" in ('user','agent','system')),
  CONSTRAINT "memory_records_revoked_actor_type_check" CHECK ("revoked_by_actor_type" is null or "revoked_by_actor_type" in ('user','agent','system'))
);
--> statement-breakpoint
CREATE TABLE "memory_evidence" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "memory_record_id" uuid NOT NULL,
  "source_class" text NOT NULL,
  "source_provider" text NOT NULL,
  "source_type" text NOT NULL,
  "source_ref" text NOT NULL,
  "source_version" text,
  "source_updated_at" timestamp with time zone,
  "observed_at" timestamp with time zone NOT NULL,
  "excerpt_hash" text NOT NULL,
  "citation_json" jsonb NOT NULL,
  "trust_level" text NOT NULL,
  "supports_or_contradicts" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "memory_evidence_source_class_check" CHECK ("source_class" in ('foundation','system_of_record','accepted_memory','private_memory','task','artifact','conversation','external_untrusted')),
  CONSTRAINT "memory_evidence_trust_level_check" CHECK ("trust_level" in ('high','medium','low','untrusted')),
  CONSTRAINT "memory_evidence_relation_check" CHECK ("supports_or_contradicts" in ('supports','contradicts','context')),
  CONSTRAINT "memory_evidence_excerpt_hash_check" CHECK ("excerpt_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "memory_bindings_company_id_id_uq" ON "memory_bindings" ("company_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "memory_records_company_id_id_uq" ON "memory_records" ("company_id","id");
--> statement-breakpoint
ALTER TABLE "memory_bindings" ADD CONSTRAINT "memory_bindings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "memory_binding_targets" ADD CONSTRAINT "memory_binding_targets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "memory_binding_targets" ADD CONSTRAINT "memory_binding_targets_company_binding_fk" FOREIGN KEY ("company_id","binding_id") REFERENCES "public"."memory_bindings"("company_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "memory_records" ADD CONSTRAINT "memory_records_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "memory_records" ADD CONSTRAINT "memory_records_company_binding_fk" FOREIGN KEY ("company_id","binding_id") REFERENCES "public"."memory_bindings"("company_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "memory_records" ADD CONSTRAINT "memory_records_owner_agent_id_agents_id_fk" FOREIGN KEY ("owner_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "memory_records" ADD CONSTRAINT "memory_records_supersedes_fk" FOREIGN KEY ("company_id","supersedes_record_id") REFERENCES "public"."memory_records"("company_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "memory_records" ADD CONSTRAINT "memory_records_superseded_by_fk" FOREIGN KEY ("company_id","superseded_by_record_id") REFERENCES "public"."memory_records"("company_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "memory_evidence" ADD CONSTRAINT "memory_evidence_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "memory_evidence" ADD CONSTRAINT "memory_evidence_company_record_fk" FOREIGN KEY ("company_id","memory_record_id") REFERENCES "public"."memory_records"("company_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "memory_bindings_company_key_uq" ON "memory_bindings" ("company_id","key");
--> statement-breakpoint
CREATE INDEX "memory_bindings_company_enabled_idx" ON "memory_bindings" ("company_id","enabled");
--> statement-breakpoint
CREATE UNIQUE INDEX "memory_binding_targets_binding_target_uq" ON "memory_binding_targets" ("binding_id","target_type","target_id");
--> statement-breakpoint
CREATE INDEX "memory_binding_targets_company_target_idx" ON "memory_binding_targets" ("company_id","target_type","target_id");
--> statement-breakpoint
CREATE INDEX "memory_records_company_review_retention_idx" ON "memory_records" ("company_id","review_state","retention_state");
--> statement-breakpoint
CREATE INDEX "memory_records_company_scope_idx" ON "memory_records" ("company_id","scope_type","scope_id");
--> statement-breakpoint
CREATE INDEX "memory_records_company_subject_idx" ON "memory_records" ("company_id","subject_type","subject_id");
--> statement-breakpoint
CREATE INDEX "memory_records_company_observed_idx" ON "memory_records" ("company_id","observed_at" DESC);
--> statement-breakpoint
CREATE INDEX "memory_records_company_validity_idx" ON "memory_records" ("company_id","valid_from","valid_until");
--> statement-breakpoint
CREATE INDEX "memory_records_company_superseded_idx" ON "memory_records" ("company_id","superseded_by_record_id");
--> statement-breakpoint
CREATE INDEX "memory_records_search_idx" ON "memory_records" USING gin (to_tsvector('simple', coalesce("title", '') || ' ' || "content" || ' ' || coalesce("summary", '')));
--> statement-breakpoint
CREATE INDEX "memory_evidence_memory_record_idx" ON "memory_evidence" ("memory_record_id");
--> statement-breakpoint
CREATE INDEX "memory_evidence_company_source_idx" ON "memory_evidence" ("company_id","source_provider","source_ref");
