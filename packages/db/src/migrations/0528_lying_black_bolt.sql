CREATE TABLE "customer_operations" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" uuid,
	"operation_type" text NOT NULL,
	"domain" text NOT NULL,
	"domain_operation_ref" text,
	"requester_key_hash" text NOT NULL,
	"requested_by_user_id" text,
	"scope_key" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"input_hash" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"progress_stage" text DEFAULT 'admitted' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"attempt_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"result_ref" jsonb,
	"error_code" text,
	"cancel_requested_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"progress_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_operations_domain_check" CHECK ("customer_operations"."operation_type"='company_import' AND "customer_operations"."domain"='company_portability'),
	CONSTRAINT "customer_operations_state_check" CHECK ("customer_operations"."status" in ('running','succeeded','failed','needs_reconciliation')),
	CONSTRAINT "customer_operations_hash_check" CHECK ("customer_operations"."requester_key_hash" ~ '^[a-f0-9]{64}$' AND "customer_operations"."input_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "customer_operations_attempt_check" CHECK ("customer_operations"."attempt"=1)
);
--> statement-breakpoint
ALTER TABLE "customer_operations" ADD CONSTRAINT "customer_operations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_operations_request_key_uq" ON "customer_operations" USING btree ("requester_key_hash","operation_type","scope_key","idempotency_key");--> statement-breakpoint
CREATE INDEX "customer_operations_requester_status_idx" ON "customer_operations" USING btree ("requester_key_hash","status");--> statement-breakpoint
CREATE INDEX "customer_operations_user_idx" ON "customer_operations" USING btree ("requested_by_user_id");