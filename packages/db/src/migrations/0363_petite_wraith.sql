CREATE TABLE "work_signal_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"source_delivery_id" uuid,
	"source_event_key" text NOT NULL,
	"source_principal_id" uuid NOT NULL,
	"source_user_id" text NOT NULL,
	"source_channel" text NOT NULL,
	"source_message_id" text NOT NULL,
	"source_hash" text NOT NULL,
	"source_revision" text NOT NULL,
	"run_id" uuid NOT NULL,
	"read_invocation_id" uuid NOT NULL,
	"signal_type" text NOT NULL,
	"sensitivity" text NOT NULL,
	"confidence" text NOT NULL,
	"purpose" text DEFAULT 'work_coordination' NOT NULL,
	"facts" jsonb,
	"status" text DEFAULT 'candidate' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"proposal_id" uuid,
	"interaction_id" uuid,
	"invalidated_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_signal_tenant_uq" UNIQUE("company_id","id"),
	CONSTRAINT "work_signal_source_version_uq" UNIQUE("company_id","endpoint_id","source_event_key","source_revision","source_hash","signal_type"),
	CONSTRAINT "work_signal_status_check" CHECK ("work_signal_candidates"."status" in ('candidate','ignored','review_requested','proposed','invalidated')),
	CONSTRAINT "work_signal_purpose_check" CHECK ("work_signal_candidates"."purpose"='work_coordination'),
	CONSTRAINT "work_signal_version_check" CHECK ("work_signal_candidates"."version">0)
);
--> statement-breakpoint
ALTER TABLE "work_signal_candidates" ADD CONSTRAINT "work_signal_candidates_company_id_issue_id_issues_company_id_id_fk" FOREIGN KEY ("company_id","issue_id") REFERENCES "public"."issues"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_signal_candidates" ADD CONSTRAINT "work_signal_candidates_company_id_endpoint_id_chat_endpoints_company_id_id_fk" FOREIGN KEY ("company_id","endpoint_id") REFERENCES "public"."chat_endpoints"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_signal_candidates" ADD CONSTRAINT "work_signal_candidates_company_id_source_delivery_id_chat_deliveries_company_id_id_fk" FOREIGN KEY ("company_id","source_delivery_id") REFERENCES "public"."chat_deliveries"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_signal_candidates" ADD CONSTRAINT "work_signal_candidates_company_id_run_id_heartbeat_runs_company_id_id_fk" FOREIGN KEY ("company_id","run_id") REFERENCES "public"."heartbeat_runs"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_signal_inbox_idx" ON "work_signal_candidates" USING btree ("company_id","source_user_id","status","created_at");