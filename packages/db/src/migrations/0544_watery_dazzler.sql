ALTER TABLE "companies" ADD COLUMN "locale" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "timezone" text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_locale_check" CHECK ("locale" in ('en', 'da'));--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_timezone_check" CHECK (length(trim("timezone")) > 0);
