ALTER TABLE "customer_operations" ADD COLUMN "lease_owner_id" uuid;--> statement-breakpoint
ALTER TABLE "customer_operations" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customer_operations" ADD COLUMN "accepted_plan" jsonb;--> statement-breakpoint
ALTER TABLE "customer_operations" ADD COLUMN "effect_checkpoint" jsonb;--> statement-breakpoint
UPDATE "customer_operations" SET "lease_owner_id" = "attempt_id",
  "lease_expires_at" = clock_timestamp() - interval '1 second'
WHERE "operation_type" = 'company_import' AND "status" = 'running';--> statement-breakpoint
ALTER TABLE "customer_operations" ADD CONSTRAINT "customer_operations_lease_check" CHECK (("customer_operations"."lease_owner_id" IS NULL) = ("customer_operations"."lease_expires_at" IS NULL));--> statement-breakpoint
ALTER TABLE "customer_operations" ADD CONSTRAINT "customer_operations_accepted_plan_check" CHECK ("customer_operations"."accepted_plan" IS NULL OR CASE
    WHEN jsonb_typeof("customer_operations"."accepted_plan") <> 'object' THEN false
    WHEN "customer_operations"."accepted_plan"->>'version' <> '1' THEN false
    WHEN "customer_operations"."accepted_plan"->>'previewFingerprint' !~ '^[a-f0-9]{64}$'
      OR "customer_operations"."accepted_plan"->>'selectedPayloadFingerprint' !~ '^[a-f0-9]{64}$' THEN false
    WHEN "customer_operations"."accepted_plan"->>'targetMode' NOT IN ('new_company','existing_company') THEN false
    WHEN "customer_operations"."accepted_plan"->>'targetMode'='existing_company' AND "customer_operations"."accepted_plan"->>'targetCompanyId' IS NULL THEN false
    WHEN jsonb_typeof("customer_operations"."accepted_plan"->'selected') <> 'array' OR jsonb_array_length("customer_operations"."accepted_plan"->'selected') > 5000 THEN false
    WHEN length(coalesce("customer_operations"."accepted_plan"->>'acceptedAt','')) NOT BETWEEN 1 AND 64 THEN false
    ELSE true END);--> statement-breakpoint
ALTER TABLE "customer_operations" ADD CONSTRAINT "customer_operations_effect_checkpoint_check" CHECK ("customer_operations"."effect_checkpoint" IS NULL OR CASE
    WHEN jsonb_typeof("customer_operations"."effect_checkpoint") <> 'object' THEN false
    WHEN "customer_operations"."effect_checkpoint"->>'version' <> '1' THEN false
    WHEN "customer_operations"."effect_checkpoint"->>'state' NOT IN ('idle','applying','complete') THEN false
    WHEN jsonb_typeof("customer_operations"."effect_checkpoint"->'idMap') <> 'array' OR jsonb_array_length("customer_operations"."effect_checkpoint"->'idMap') > 5000 THEN false
    WHEN ("customer_operations"."effect_checkpoint"->>'state'='applying') IS DISTINCT FROM ("customer_operations"."effect_checkpoint"->'activeEffect' IS DISTINCT FROM 'null'::jsonb) THEN false
    ELSE true END);
