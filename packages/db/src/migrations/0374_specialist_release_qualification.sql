-- Release evidence stays independent: local protocol and customer demand are
-- different dimensions. Existing internal fixtures remain usable.
CREATE FUNCTION aw_v7_package_release_current(v agent_package_versions) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT v.state='published'
  AND (v.release->'releaseEvidence'->>'evaluatedAt')::timestamptz<=now()
  AND (v.release->'releaseEvidence'->>'expiresAt')::timestamptz>now()
  AND v.release->'releaseEvidence'->'unresolvedCritical'='[]'::jsonb
  AND (v.release->'manifest'->>'audience'='internal_test' OR (
   v.release->'manifest'->>'audience'='customer'
   AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['sbom','scan','evaluations','protectedHoldout','customerDemand']) dimension
    WHERE jsonb_typeof(v.release->'releaseEvidence'->dimension) IS DISTINCT FROM 'object'
     OR coalesce(v.release->'releaseEvidence'->dimension->>'sha256','') !~ '^[a-f0-9]{64}$'
     OR coalesce(v.release->'releaseEvidence'->dimension->>'uri','') NOT LIKE 'https://%')
   AND (v.release->'manifest'->>'sandboxAssurance'<>'qualified_managed'
     OR jsonb_typeof(v.release->'releaseEvidence'->'sandboxQualification')='object')
  ));
$$;
--> statement-breakpoint
DO $$ BEGIN
 EXECUTE replace(pg_get_functiondef('aw_v7_package_installation_current(company_agent_package_installations)'::regprocedure),
   'aw_v7_package_installation_current(', 'aw_v7_package_installation_current_without_release_gate(');
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v7_package_installation_current(i company_agent_package_installations) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT aw_v7_package_installation_current_without_release_gate(i)
 AND EXISTS(SELECT 1 FROM agent_package_versions v WHERE v.id=i.installed_version_id AND aw_v7_package_release_current(v));
$$;
