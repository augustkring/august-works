ALTER TABLE "workflows"
  ADD CONSTRAINT "workflows_distinct_revision_pointers_check"
  CHECK ("published_revision_id" is null or "draft_revision_id" is null or "published_revision_id" <> "draft_revision_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_revisions_one_draft_uq"
  ON "workflow_revisions" USING btree ("workflow_id")
  WHERE "state" = 'draft';
--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_revisions_one_published_uq"
  ON "workflow_revisions" USING btree ("workflow_id")
  WHERE "state" = 'published';
--> statement-breakpoint
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
      ARRAY['workflows:read', 'workflows:edit', 'workflows:publish', 'workflows:run']::text[]
    WHEN cm."membership_role" = 'viewer' THEN
      ARRAY['workflows:read']::text[]
    ELSE
      ARRAY['workflows:read', 'workflows:edit', 'workflows:run']::text[]
  END
) AS permission("permission_key")
WHERE cm."principal_type" = 'user'
  AND cm."status" = 'active'
ON CONFLICT ("company_id", "principal_type", "principal_id", "permission_key") DO NOTHING;
