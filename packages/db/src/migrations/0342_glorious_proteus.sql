CREATE TABLE "saas_run_log_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"event_seq" integer,
	"byte_offset" bigint NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"key_id" text NOT NULL,
	"ciphertext" text,
	"object_key" text NOT NULL,
	"object_sha256" text NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "saas_run_log_chunks_size_ck" CHECK ("saas_run_log_chunks"."byte_offset" >= 0 and "saas_run_log_chunks"."byte_size" > 0 and "saas_run_log_chunks"."ordinal" > 0)
);
--> statement-breakpoint
CREATE TABLE "saas_run_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"log_ref" text NOT NULL,
	"byte_size" bigint DEFAULT 0 NOT NULL,
	"pending_bytes" bigint DEFAULT 0 NOT NULL,
	"next_ordinal" integer DEFAULT 1 NOT NULL,
	"finalized_at" timestamp with time zone,
	"sha256" text,
	"erased_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saas_run_logs_size_ck" CHECK ("saas_run_logs"."byte_size" >= 0 and "saas_run_logs"."pending_bytes" >= 0 and "saas_run_logs"."next_ordinal" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "saas_run_logs_company_id_uq" ON "saas_run_logs" USING btree ("company_id","id");--> statement-breakpoint
ALTER TABLE "saas_run_log_chunks" ADD CONSTRAINT "saas_run_log_chunks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saas_run_log_chunks" ADD CONSTRAINT "saas_run_log_chunks_company_id_run_id_saas_run_logs_company_id_id_fk" FOREIGN KEY ("company_id","run_id") REFERENCES "public"."saas_run_logs"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saas_run_logs" ADD CONSTRAINT "saas_run_logs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "saas_run_log_chunks_ordinal_uq" ON "saas_run_log_chunks" USING btree ("run_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "saas_run_log_chunks_event_uq" ON "saas_run_log_chunks" USING btree ("run_id","event_seq") WHERE "saas_run_log_chunks"."event_seq" is not null;--> statement-breakpoint
CREATE INDEX "saas_run_log_chunks_pending_idx" ON "saas_run_log_chunks" USING btree ("archived_at");--> statement-breakpoint
CREATE UNIQUE INDEX "saas_run_logs_ref_uq" ON "saas_run_logs" USING btree ("log_ref");--> statement-breakpoint
CREATE INDEX "saas_run_logs_flush_idx" ON "saas_run_logs" USING btree ("pending_bytes");