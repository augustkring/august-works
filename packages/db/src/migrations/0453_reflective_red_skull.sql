CREATE TABLE "customer_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"category" text NOT NULL,
	"body" text NOT NULL,
	"goal" text DEFAULT '' NOT NULL,
	"blocks_work" boolean DEFAULT false NOT NULL,
	"submitted_by_user_id" text,
	"omit_name" boolean DEFAULT false NOT NULL,
	"context" jsonb NOT NULL,
	"diagnostics" jsonb,
	"status" text DEFAULT 'RECEIVED' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_feedback_category_check" CHECK ("customer_feedback"."category" in ('BUG','IMPROVEMENT','IDEA','OTHER')),
	CONSTRAINT "customer_feedback_status_check" CHECK ("customer_feedback"."status" in ('RECEIVED','REVIEWING','NEEDS_INFO','RESOLVED','CLOSED')),
	CONSTRAINT "customer_feedback_name_check" CHECK (not "customer_feedback"."omit_name" or "customer_feedback"."submitted_by_user_id" is null)
);
--> statement-breakpoint
CREATE TABLE "customer_feedback_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"feedback_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"request_key" uuid NOT NULL,
	"request_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_feedback_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"feedback_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"customer_visible" boolean NOT NULL,
	"request_key" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_feedback" ADD CONSTRAINT "customer_feedback_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_feedback_access" ADD CONSTRAINT "customer_feedback_access_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_feedback_access" ADD CONSTRAINT "customer_feedback_access_feedback_id_customer_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."customer_feedback"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_feedback_events" ADD CONSTRAINT "customer_feedback_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_feedback_events" ADD CONSTRAINT "customer_feedback_events_feedback_id_customer_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."customer_feedback"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_feedback_company_created_idx" ON "customer_feedback" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_feedback_access_request_idx" ON "customer_feedback_access" USING btree ("company_id","user_id","request_key");--> statement-breakpoint
CREATE INDEX "customer_feedback_access_owner_idx" ON "customer_feedback_access" USING btree ("company_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_feedback_events_request_idx" ON "customer_feedback_events" USING btree ("feedback_id","request_key");--> statement-breakpoint
CREATE INDEX "customer_feedback_events_feedback_idx" ON "customer_feedback_events" USING btree ("company_id","feedback_id","created_at");