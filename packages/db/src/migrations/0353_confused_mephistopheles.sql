CREATE TABLE "cognitive_memory_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"binding_key" text NOT NULL,
	"provider_key" text NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" text,
	"mode" text DEFAULT 'governed_only' NOT NULL,
	"purpose" text NOT NULL,
	"sensitivity_ceiling" text DEFAULT 'internal' NOT NULL,
	"approved_private_projection" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"capability_snapshot" jsonb,
	"conformance_hash" text,
	"last_healthy_at" timestamp with time zone,
	"last_reconciled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cognitive_bindings_company_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "cognitive_bindings_company_key_uq" UNIQUE("company_id","binding_key"),
	CONSTRAINT "cognitive_bindings_mode_check" CHECK ("cognitive_memory_bindings"."mode" = 'governed_only'),
	CONSTRAINT "cognitive_bindings_scope_check" CHECK (("cognitive_memory_bindings"."scope_type"='company' and "cognitive_memory_bindings"."scope_id" is null) or ("cognitive_memory_bindings"."scope_type" in ('agent','project','subject') and "cognitive_memory_bindings"."scope_id" is not null)),
	CONSTRAINT "cognitive_bindings_status_check" CHECK ("cognitive_memory_bindings"."status" in ('active','degraded','disabled')),
	CONSTRAINT "cognitive_bindings_private_check" CHECK (not "cognitive_memory_bindings"."approved_private_projection" or "cognitive_memory_bindings"."scope_type"='agent')
);
--> statement-breakpoint
CREATE TABLE "cognitive_provider_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"binding_id" uuid NOT NULL,
	"operation_type" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"record_versions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"receipt_hash" text,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "cognitive_operations_type_check" CHECK ("cognitive_provider_operations"."operation_type" in ('reconcile','delete')),
	CONSTRAINT "cognitive_operations_status_check" CHECK ("cognitive_provider_operations"."status" in ('queued','running','succeeded','failed'))
);
--> statement-breakpoint
ALTER TABLE "cognitive_memory_bindings" ADD CONSTRAINT "cognitive_memory_bindings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cognitive_provider_operations" ADD CONSTRAINT "cognitive_provider_operations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cognitive_provider_operations" ADD CONSTRAINT "cognitive_operations_binding_fk" FOREIGN KEY ("company_id","binding_id") REFERENCES "public"."cognitive_memory_bindings"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cognitive_operations_pending_idx" ON "cognitive_provider_operations" USING btree ("company_id","status");