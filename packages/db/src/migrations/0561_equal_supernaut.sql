CREATE TABLE "human_workflow_coverages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"principal_user_id" text NOT NULL,
	"delegatee_user_id" text NOT NULL,
	"action_key" text DEFAULT 'workflows:run' NOT NULL,
	"workflow_id" uuid NOT NULL,
	"workflow_revision_id" uuid NOT NULL,
	"scope_type" text NOT NULL,
	"task_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "human_workflow_coverages_company_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "human_workflow_coverages_company_request_uq" UNIQUE("company_id","request_id"),
	CONSTRAINT "human_workflow_coverages_action_check" CHECK ("human_workflow_coverages"."action_key" = 'workflows:run'),
	CONSTRAINT "human_workflow_coverages_scope_check" CHECK (("human_workflow_coverages"."scope_type" = 'manual' and "human_workflow_coverages"."task_id" is null) or ("human_workflow_coverages"."scope_type" = 'task' and "human_workflow_coverages"."task_id" is not null)),
	CONSTRAINT "human_workflow_coverages_interval_check" CHECK ("human_workflow_coverages"."expires_at" > "human_workflow_coverages"."starts_at" and "human_workflow_coverages"."reason" <> ''),
	CONSTRAINT "human_workflow_coverages_revocation_pair_check" CHECK ("human_workflow_coverages"."revoked_at" is not null or "human_workflow_coverages"."revoked_by_user_id" is null)
);
--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "human_coverage_id" uuid;--> statement-breakpoint
ALTER TABLE "human_workflow_coverages" ADD CONSTRAINT "human_workflow_coverages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "human_workflow_coverages" ADD CONSTRAINT "human_workflow_coverages_principal_user_id_user_id_fk" FOREIGN KEY ("principal_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "human_workflow_coverages" ADD CONSTRAINT "human_workflow_coverages_delegatee_user_id_user_id_fk" FOREIGN KEY ("delegatee_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "human_workflow_coverages" ADD CONSTRAINT "human_workflow_coverages_revision_fk" FOREIGN KEY ("company_id","workflow_id","workflow_revision_id") REFERENCES "public"."workflow_revisions"("company_id","workflow_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "human_workflow_coverages" ADD CONSTRAINT "human_workflow_coverages_workflow_fk" FOREIGN KEY ("company_id","workflow_id") REFERENCES "public"."workflows"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "human_workflow_coverages" ADD CONSTRAINT "human_workflow_coverages_task_fk" FOREIGN KEY ("company_id","task_id") REFERENCES "public"."issues"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "human_workflow_coverages_principal_idx" ON "human_workflow_coverages" USING btree ("company_id","principal_user_id","expires_at");--> statement-breakpoint
CREATE INDEX "human_workflow_coverages_delegatee_idx" ON "human_workflow_coverages" USING btree ("company_id","delegatee_user_id","expires_at");