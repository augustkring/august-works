CREATE TABLE "support_case_issue_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"linked_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_case_issue_links_company_case_uq" UNIQUE("company_id","case_id")
);
--> statement-breakpoint
ALTER TABLE "support_case_issue_links" ADD CONSTRAINT "support_case_issue_links_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_case_issue_links" ADD CONSTRAINT "support_case_issue_links_linked_by_user_id_user_id_fk" FOREIGN KEY ("linked_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_case_issue_links" ADD CONSTRAINT "support_case_issue_links_case_fk" FOREIGN KEY ("company_id","case_id") REFERENCES "public"."support_cases"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_case_issue_links" ADD CONSTRAINT "support_case_issue_links_issue_fk" FOREIGN KEY ("company_id","issue_id") REFERENCES "public"."issues"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_case_issue_links_issue_idx" ON "support_case_issue_links" USING btree ("company_id","issue_id");