CREATE TABLE "runtime_host_provider_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"runtime_host_id" uuid NOT NULL,
	"operation_type" text NOT NULL,
	"status" text DEFAULT 'REQUESTED' NOT NULL,
	"request_hash" text NOT NULL,
	"not_before" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"error_code" text,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "runtime_host_provider_operations_type_ck" CHECK ("runtime_host_provider_operations"."operation_type" in ('create','fence','delete')),
	CONSTRAINT "runtime_host_provider_operations_status_ck" CHECK ("runtime_host_provider_operations"."status" in ('REQUESTED','WRITING','NEEDS_RECONCILIATION','SUCCEEDED','FAILED'))
);
--> statement-breakpoint
ALTER TABLE "runtime_host_provider_operations" ADD CONSTRAINT "runtime_host_provider_operations_runtime_host_id_runtime_hosts_id_fk" FOREIGN KEY ("runtime_host_id") REFERENCES "public"."runtime_hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_host_provider_operations_once_uq" ON "runtime_host_provider_operations" USING btree ("runtime_host_id","operation_type");--> statement-breakpoint
CREATE INDEX "runtime_host_provider_operations_work_idx" ON "runtime_host_provider_operations" USING btree ("status","not_before");