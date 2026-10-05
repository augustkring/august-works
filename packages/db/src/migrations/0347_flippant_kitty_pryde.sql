CREATE TABLE "runtime_backup_policies" (
	"runtime_cell_id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"created_by_user_id" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"allow_brief_pause" boolean DEFAULT false NOT NULL,
	"interval_hours" integer DEFAULT 24 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"phase" text DEFAULT 'idle' NOT NULL,
	"cycle_id" uuid,
	"cycle_generation" bigint,
	"resume_after_backup" boolean DEFAULT false NOT NULL,
	"operation_id" uuid,
	"next_due_at" timestamp with time zone DEFAULT now() NOT NULL,
	"not_before" timestamp with time zone DEFAULT now() NOT NULL,
	"last_success_at" timestamp with time zone,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runtime_backup_policies_interval_ck" CHECK ("runtime_backup_policies"."interval_hours" between 24 and 168),
	CONSTRAINT "runtime_backup_policies_phase_ck" CHECK ("runtime_backup_policies"."phase" in ('idle','await_stop','await_backup','await_start'))
);
--> statement-breakpoint
ALTER TABLE "runtime_backup_policies" ADD CONSTRAINT "runtime_backup_policies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_backup_policies" ADD CONSTRAINT "runtime_backup_policies_operation_id_runtime_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."runtime_operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_backup_policies" ADD CONSTRAINT "runtime_backup_policies_company_id_runtime_cell_id_runtime_cells_company_id_id_fk" FOREIGN KEY ("company_id","runtime_cell_id") REFERENCES "public"."runtime_cells"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "runtime_backup_policies_due_idx" ON "runtime_backup_policies" USING btree ("not_before");