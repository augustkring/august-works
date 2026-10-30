ALTER TABLE "customer_operations" ADD COLUMN "source_release_review" jsonb;--> statement-breakpoint
ALTER TABLE "customer_operations" ADD CONSTRAINT "customer_operations_source_release_review_check" CHECK ("customer_operations"."source_release_review" IS NULL OR CASE
    WHEN jsonb_typeof("customer_operations"."source_release_review") <> 'object' THEN false
    WHEN "customer_operations"."source_release_review"->>'version' <> '1' THEN false
    WHEN "customer_operations"."source_release_review"->>'sourceMode' NOT IN ('native_owner','manual_open_content') THEN false
    WHEN jsonb_typeof("customer_operations"."source_release_review"->'sourceCompanyIds') <> 'array'
      OR jsonb_array_length("customer_operations"."source_release_review"->'sourceCompanyIds') > 1 THEN false
    WHEN jsonb_typeof("customer_operations"."source_release_review"->'sourceItems') <> 'array'
      OR jsonb_array_length("customer_operations"."source_release_review"->'sourceItems') > 1000 THEN false
    WHEN "customer_operations"."source_release_review"->>'sourceAccess' NOT IN ('verified_current_acl','reviewed_open_external') THEN false
    WHEN ("customer_operations"."source_release_review"->>'sourceMode'='native_owner') <> ("customer_operations"."source_release_review"->>'sourceAccess'='verified_current_acl') THEN false
    WHEN "customer_operations"."source_release_review"->>'targetMode' NOT IN ('new_company','existing_company') THEN false
    WHEN "customer_operations"."source_release_review"->>'targetMode'='existing_company' AND "customer_operations"."source_release_review"->>'targetCompanyId' IS NULL THEN false
    WHEN "customer_operations"."source_release_review"->>'previewFingerprint' !~ '^[a-f0-9]{64}$'
      OR "customer_operations"."source_release_review"->>'selectedPayloadFingerprint' !~ '^[a-f0-9]{64}$' THEN false
    WHEN length(coalesce("customer_operations"."source_release_review"->>'reviewedByUserId','')) NOT BETWEEN 1 AND 256 THEN false
    WHEN length(coalesce("customer_operations"."source_release_review"->>'reviewedAt','')) NOT BETWEEN 1 AND 64 THEN false
    ELSE true END);