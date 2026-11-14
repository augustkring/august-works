CREATE TABLE "chat_github_resource_migrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"provider_repository_id" text NOT NULL,
	"from_repository" text NOT NULL,
	"to_repository" text NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_github_resource_migrations_repository_id_check" CHECK ("chat_github_resource_migrations"."provider_repository_id" ~ '^[0-9]+$'),
	CONSTRAINT "chat_github_resource_migrations_coordinates_check" CHECK ("chat_github_resource_migrations"."from_repository" <> "chat_github_resource_migrations"."to_repository" and "chat_github_resource_migrations"."from_repository" ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' and "chat_github_resource_migrations"."to_repository" ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$')
);
--> statement-breakpoint
ALTER TABLE "chat_github_resource_migrations" ADD CONSTRAINT "chat_github_resource_migrations_company_endpoint_fk" FOREIGN KEY ("company_id","endpoint_id") REFERENCES "public"."chat_endpoints"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_github_resource_migrations" ADD CONSTRAINT "chat_github_resource_migrations_company_resource_fk" FOREIGN KEY ("company_id","resource_id") REFERENCES "public"."chat_endpoint_resources"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_github_resource_migrations_edge_uq" ON "chat_github_resource_migrations" USING btree ("company_id","endpoint_id","resource_id","provider_repository_id","from_repository","to_repository");--> statement-breakpoint
CREATE INDEX "chat_github_resource_migrations_from_idx" ON "chat_github_resource_migrations" USING btree ("company_id","endpoint_id","resource_id","provider_repository_id","from_repository");