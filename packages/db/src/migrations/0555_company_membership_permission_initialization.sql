ALTER TABLE "company_memberships" ADD COLUMN "permissions_initialized_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "company_memberships"
SET "permissions_initialized_at" = clock_timestamp()
WHERE "principal_type" = 'user' AND "permissions_initialized_at" IS NULL;
