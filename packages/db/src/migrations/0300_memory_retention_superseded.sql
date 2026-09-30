ALTER TABLE "memory_records" DROP CONSTRAINT IF EXISTS "memory_records_retention_state_check";
--> statement-breakpoint
ALTER TABLE "memory_records" ADD CONSTRAINT "memory_records_retention_state_check" CHECK ("retention_state" in ('active','expired','superseded'));
