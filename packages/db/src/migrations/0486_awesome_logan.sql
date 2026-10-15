CREATE TABLE "agent_configuration_runtime_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"draft_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"created_by_user_id" text NOT NULL,
	"creation_request_id" uuid NOT NULL,
	"creation_request_hash" text NOT NULL,
	"model_profile_id" uuid NOT NULL,
	"profile_hash" text NOT NULL,
	"baseline_configuration_hash" text NOT NULL,
	"configuration_hash" text NOT NULL,
	"source_sha" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"qualification_request_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_configuration_runtime_candidates_state_check" CHECK ("agent_configuration_runtime_candidates"."status" in ('draft','testing','qualified','failed','unknown','retired')),
	CONSTRAINT "agent_configuration_runtime_candidates_qualification_check" CHECK (("agent_configuration_runtime_candidates"."status"='qualified') = ("agent_configuration_runtime_candidates"."qualification_request_id" is not null)),
	CONSTRAINT "agent_configuration_runtime_candidates_hashes_check" CHECK ("agent_configuration_runtime_candidates"."creation_request_hash" ~ '^[a-f0-9]{64}$' and "agent_configuration_runtime_candidates"."profile_hash" ~ '^[a-f0-9]{64}$'
    and "agent_configuration_runtime_candidates"."baseline_configuration_hash" ~ '^[a-f0-9]{64}$' and "agent_configuration_runtime_candidates"."configuration_hash" ~ '^[a-f0-9]{64}$' and "agent_configuration_runtime_candidates"."source_sha" ~ '^[a-f0-9]{40}$')
);
--> statement-breakpoint
CREATE TABLE "agent_runtime_candidate_conformance_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"created_by_user_id" text NOT NULL,
	"request_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"expected_draft_version" integer NOT NULL,
	"candidate_hash" text NOT NULL,
	"input" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"evidence" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "agent_runtime_candidate_conformance_requests_state_check" CHECK ("agent_runtime_candidate_conformance_requests"."status" in ('pending','qualified','failed','unknown')),
	CONSTRAINT "agent_runtime_candidate_conformance_requests_finished_check" CHECK (("agent_runtime_candidate_conformance_requests"."status"='pending') = ("agent_runtime_candidate_conformance_requests"."finished_at" is null)),
	CONSTRAINT "agent_runtime_candidate_conformance_requests_version_check" CHECK ("agent_runtime_candidate_conformance_requests"."expected_draft_version">0),
	CONSTRAINT "agent_runtime_candidate_conformance_requests_hashes_check" CHECK ("agent_runtime_candidate_conformance_requests"."request_hash" ~ '^[a-f0-9]{64}$' and "agent_runtime_candidate_conformance_requests"."candidate_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "agent_runtime_candidate_conformance_requests_evidence_check" CHECK ("agent_runtime_candidate_conformance_requests"."evidence" is null or (jsonb_typeof("agent_runtime_candidate_conformance_requests"."evidence")='object' and octet_length("agent_runtime_candidate_conformance_requests"."evidence"::text)<=16384)),
	CONSTRAINT "agent_runtime_candidate_conformance_requests_input_check" CHECK (jsonb_typeof("agent_runtime_candidate_conformance_requests"."input")='object' and octet_length("agent_runtime_candidate_conformance_requests"."input"::text)<=1024)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_configuration_runtime_candidates_company_id_id_uq" ON "agent_configuration_runtime_candidates" USING btree ("company_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_configuration_runtime_candidates_request_uq" ON "agent_configuration_runtime_candidates" USING btree ("company_id","created_by_user_id","creation_request_id");
--> statement-breakpoint
CREATE INDEX "agent_configuration_runtime_candidates_draft_idx" ON "agent_configuration_runtime_candidates" USING btree ("company_id","draft_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_runtime_candidate_conformance_requests_request_uq" ON "agent_runtime_candidate_conformance_requests" USING btree ("company_id","created_by_user_id","request_id");
--> statement-breakpoint
CREATE INDEX "agent_runtime_candidate_conformance_requests_candidate_idx" ON "agent_runtime_candidate_conformance_requests" USING btree ("company_id","candidate_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_configuration_drafts_company_id_id_uq" ON "agent_configuration_drafts" USING btree ("company_id","id");
--> statement-breakpoint
ALTER TABLE "agent_configuration_runtime_candidates" ADD CONSTRAINT "agent_configuration_runtime_candidates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_configuration_runtime_candidates" ADD CONSTRAINT "agent_configuration_runtime_candidates_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_configuration_runtime_candidates" ADD CONSTRAINT "agent_configuration_runtime_candidates_company_id_draft_id_agent_configuration_drafts_company_id_id_fk" FOREIGN KEY ("company_id","draft_id") REFERENCES "public"."agent_configuration_drafts"("company_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_configuration_runtime_candidates" ADD CONSTRAINT "agent_configuration_runtime_candidates_company_id_agent_id_agents_company_id_id_fk" FOREIGN KEY ("company_id","agent_id") REFERENCES "public"."agents"("company_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_runtime_candidate_conformance_requests" ADD CONSTRAINT "agent_runtime_candidate_conformance_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_runtime_candidate_conformance_requests" ADD CONSTRAINT "agent_runtime_candidate_conformance_requests_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_runtime_candidate_conformance_requests" ADD CONSTRAINT "agent_runtime_candidate_conformance_requests_company_id_candidate_id_agent_configuration_runtime_candidates_company_id_id_fk" FOREIGN KEY ("company_id","candidate_id") REFERENCES "public"."agent_configuration_runtime_candidates"("company_id","id") ON DELETE cascade ON UPDATE no action;
