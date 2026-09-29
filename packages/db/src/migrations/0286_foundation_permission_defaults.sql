INSERT INTO "principal_permission_grants" (
  "company_id",
  "principal_type",
  "principal_id",
  "permission_key",
  "scope",
  "granted_by_user_id",
  "created_at",
  "updated_at"
)
SELECT
  cm."company_id",
  'user',
  cm."principal_id",
  permission."permission_key",
  NULL,
  NULL,
  now(),
  now()
FROM "company_memberships" cm
CROSS JOIN LATERAL unnest(
  CASE
    WHEN cm."membership_role" IN ('owner', 'admin') THEN
      ARRAY['foundation:read', 'foundation:propose', 'foundation:edit', 'foundation:approve']::text[]
    WHEN cm."membership_role" = 'viewer' THEN
      ARRAY['foundation:read']::text[]
    ELSE
      ARRAY['foundation:read', 'foundation:propose', 'foundation:edit']::text[]
  END
) AS permission("permission_key")
WHERE cm."principal_type" = 'user'
  AND cm."status" = 'active'
ON CONFLICT ("company_id", "principal_type", "principal_id", "permission_key") DO NOTHING;
