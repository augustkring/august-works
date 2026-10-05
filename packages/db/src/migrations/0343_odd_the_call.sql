ALTER TABLE "runtime_cells" ADD COLUMN "model_provider" text;--> statement-breakpoint
ALTER TABLE "runtime_cells" ADD COLUMN "model_id" text;--> statement-breakpoint
ALTER TABLE "runtime_cells" ADD COLUMN "model_secret_ref" uuid;--> statement-breakpoint
ALTER TABLE "runtime_cells" ADD COLUMN "model_secret_version" integer;