CREATE TABLE "business_event_backfill_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"projector_version" text NOT NULL,
	"window_from" timestamp with time zone NOT NULL,
	"window_until" timestamp with time zone NOT NULL,
	"start_cursor_json" jsonb,
	"last_source_cursor_json" jsonb,
	"batch_limit" integer NOT NULL,
	"projected" integer NOT NULL,
	"unchanged" integer NOT NULL,
	"status" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_event_backfill_runs_window_check" CHECK ("business_event_backfill_runs"."window_until" >= "business_event_backfill_runs"."window_from"),
	CONSTRAINT "business_event_backfill_runs_bounds_check" CHECK ("business_event_backfill_runs"."batch_limit" between 1 and 200 and "business_event_backfill_runs"."projected" >= 0 and "business_event_backfill_runs"."unchanged" >= 0 and "business_event_backfill_runs"."projected" + "business_event_backfill_runs"."unchanged" <= "business_event_backfill_runs"."batch_limit"),
	CONSTRAINT "business_event_backfill_runs_status_check" CHECK ("business_event_backfill_runs"."status" in ('batch_limit_reached','window_scan_exhausted'))
);
--> statement-breakpoint
ALTER TABLE "business_event_backfill_runs" ADD CONSTRAINT "business_event_backfill_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "business_event_backfill_runs_company_time_idx" ON "business_event_backfill_runs" USING btree ("company_id","recorded_at");