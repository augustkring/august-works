CREATE TABLE "company_cross_company_policies" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"policy" jsonb DEFAULT '{"allowRead":false,"allowContribute":false,"allowAct":false,"allowedSensitivities":["public","internal"]}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_cross_company_policies" ADD CONSTRAINT "company_cross_company_policies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;