ALTER TABLE "orchestration_company_purpose_reservations" ADD COLUMN "package_version_id" uuid;--> statement-breakpoint
ALTER TABLE "orchestration_company_purpose_reservations" ADD CONSTRAINT "orchestration_company_purpose_reservations_package_version_id_agent_package_versions_id_fk" FOREIGN KEY ("package_version_id") REFERENCES "public"."agent_package_versions"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
-- The included support release is a published, source-pinned package version,
-- not an Agent installation. It remains C1/internal-draft-only and carries no
-- commercial entitlement, connection, persistent-memory, or code execution.
CREATE OR REPLACE FUNCTION aw_v7_package_release_current(v agent_package_versions) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT v.state='published'
  AND (v.release->'releaseEvidence'->>'evaluatedAt')::timestamptz<=now()
  AND (v.release->'releaseEvidence'->>'expiresAt')::timestamptz>now()
  AND v.release->'releaseEvidence'->'unresolvedCritical'='[]'::jsonb
  AND (
   v.release->'manifest'->>'audience'='internal_test'
   OR (
    v.release->'manifest'->>'audience'='customer'
    AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['sbom','scan','evaluations','protectedHoldout','customerDemand']) dimension
     WHERE jsonb_typeof(v.release->'releaseEvidence'->dimension) IS DISTINCT FROM 'object'
      OR coalesce(v.release->'releaseEvidence'->dimension->>'sha256','') !~ '^[a-f0-9]{64}$'
      OR coalesce(v.release->'releaseEvidence'->dimension->>'uri','') NOT LIKE 'https://%')
    AND (v.release->'manifest'->>'sandboxAssurance'<>'qualified_managed'
      OR jsonb_typeof(v.release->'releaseEvidence'->'sandboxQualification')='object')
   )
   OR (
    v.release->>'packageKey'='paperclip-support'
    AND v.release->'manifest'->>'audience'='first_party_support'
    AND v.release->'manifest'->>'maximumRisk'='C1'
    AND v.release->'manifest'->'actionClasses'='["internal_draft"]'::jsonb
    AND v.release->'manifest'->'requiredConnections'='[]'::jsonb
    AND v.release->'manifest'->'optionalConnections'='[]'::jsonb
    AND v.release->'manifest'->>'memoryPolicy'='no_persistent_memory'
    AND v.release->'manifest'->>'commercialProductKey' IS NULL
    AND v.release->'manifest'->>'sandboxAssurance'='read_only_no_code_execution'
    AND v.release->'manifest'->'runtimeProviders'='["paperclip_native"]'::jsonb
    AND jsonb_array_length(v.release->'manifest'->'requiredKnowledge') BETWEEN 1 AND 30
    AND coalesce(v.release->'manifest'->>'sourceRevision','') ~ '^[a-f0-9]{40}$'
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(v.release->'components','[]'::jsonb)) c
      WHERE c->>'type' IN ('workflow_template','routine_template','use_case_template','onboarding_template'))
    AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['sbom','provenance','signature','scan','evaluations','protectedHoldout','releaseAuthorization']) dimension
     WHERE jsonb_typeof(v.release->'releaseEvidence'->dimension) IS DISTINCT FROM 'object'
      OR coalesce(v.release->'releaseEvidence'->dimension->>'sha256','') !~ '^[a-f0-9]{64}$'
      OR coalesce(v.release->'releaseEvidence'->dimension->>'uri','') NOT LIKE 'https://%')
   )
  );
$$;
--> statement-breakpoint
-- Direct SQL cannot invent an unpinned support invocation. The version is
-- immutable and is rechecked against the budget's actual source SHA at both
-- reservation and dispatch. Existing legacy rows remain retained but cannot
-- be dispatched without the new exact pin.
CREATE OR REPLACE FUNCTION aw_v10_company_purpose_package_pin_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_sha text;
BEGIN
  IF TG_OP='UPDATE' AND NEW.package_version_id IS DISTINCT FROM OLD.package_version_id THEN
    RAISE EXCEPTION 'company_purpose_package_pin_immutable' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' AND NEW.package_version_id IS NULL THEN
    RAISE EXCEPTION 'company_purpose_package_pin_required' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' OR (TG_OP='UPDATE' AND NEW.status='dispatched' AND OLD.status IS DISTINCT FROM 'dispatched') THEN
    SELECT b.source_sha INTO source_sha FROM orchestration_company_purpose_budgets b
      WHERE b.company_id=NEW.company_id AND b.id=NEW.budget_id AND b.purpose='first_party_support';
    IF source_sha IS NULL OR NOT EXISTS (
      SELECT 1 FROM agent_package_versions v
      JOIN agent_packages p ON p.id=v.agent_package_id
      WHERE v.id=NEW.package_version_id AND p.package_key='paperclip-support' AND p.status='active'
        AND v.state='published' AND aw_v7_package_release_current(v)
        AND v.release->'manifest'->>'sourceRevision'=source_sha
      FOR SHARE OF v,p
    ) THEN
      RAISE EXCEPTION 'company_purpose_package_pin_not_current' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER aw_v10_company_purpose_package_pin_guard
  BEFORE INSERT OR UPDATE ON orchestration_company_purpose_reservations
  FOR EACH ROW EXECUTE FUNCTION aw_v10_company_purpose_package_pin_guard();
