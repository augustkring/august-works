ALTER TABLE "runtime_backups" ADD COLUMN "verification_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "runtime_backups" ADD COLUMN "verification_not_before" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "runtime_backups" ADD COLUMN "verification_error_code" text;