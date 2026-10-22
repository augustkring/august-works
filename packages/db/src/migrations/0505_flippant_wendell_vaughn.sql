ALTER TABLE "projects" DROP CONSTRAINT "projects_source_bound_check";--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "source_project_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_source_bound_check" CHECK (cardinality("projects"."source_issue_ids") + cardinality("projects"."source_project_ids") <= 256
      and array_position("projects"."source_issue_ids",null) is null and array_position("projects"."source_project_ids",null) is null);
--> statement-breakpoint
-- Extend the original Project retention owner; no source FK can erase roots.
CREATE OR REPLACE FUNCTION aw_retain_project_privacy_sources() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  SELECT coalesce(array_agg(source_id ORDER BY source_id),'{}'::uuid[]) INTO NEW.source_issue_ids
    FROM (SELECT DISTINCT unnest(OLD.source_issue_ids || NEW.source_issue_ids) AS source_id) retained;
  SELECT coalesce(array_agg(source_id ORDER BY source_id),'{}'::uuid[]) INTO NEW.source_project_ids
    FROM (SELECT DISTINCT unnest(OLD.source_project_ids || NEW.source_project_ids) AS source_id) retained;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_record_task_privacy_sources() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_run uuid; source_task uuid;
BEGIN
  IF TG_OP='UPDATE' THEN
    INSERT INTO issue_privacy_sources(company_id,issue_id,source_kind,source_id)
      SELECT NEW.company_id,NEW.id,v.kind,v.id FROM (VALUES
        ('issue',OLD.parent_id),('issue',OLD.privacy_parent_issue_id),('project',OLD.project_id)) v(kind,id)
      WHERE v.id IS NOT NULL AND NOT(v.kind='issue' AND v.id=NEW.id) ON CONFLICT DO NOTHING;
  END IF;
  INSERT INTO issue_privacy_sources(company_id,issue_id,source_kind,source_id)
    SELECT NEW.company_id,NEW.id,v.kind,v.id FROM (VALUES
      ('issue',NEW.parent_id),('issue',NEW.privacy_parent_issue_id),('project',NEW.project_id)) v(kind,id)
    WHERE v.id IS NOT NULL AND NOT(v.kind='issue' AND v.id=NEW.id) ON CONFLICT DO NOTHING;
  IF NEW.origin_run_id ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN
    source_run := NEW.origin_run_id::uuid;
    SELECT coalesce(r.issue_id,r.native_issue_id) INTO source_task FROM heartbeat_runs r
      WHERE r.id=source_run AND r.company_id=NEW.company_id;
    -- A run of this very task is not a new copy edge. All other origins,
    -- including missing/foreign runs, remain exact retained source identities.
    IF source_task IS DISTINCT FROM NEW.id THEN
      INSERT INTO issue_privacy_sources(company_id,issue_id,source_kind,source_id)
        VALUES(NEW.company_id,NEW.id,'run',source_run) ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  -- Actual retained Context roots belong to the original producer run. A
  -- copied Task keeps them even when the manifest is later removed.
  IF NEW.origin_run_id ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN
    INSERT INTO issue_privacy_sources(company_id,issue_id,source_kind,source_id)
      SELECT NEW.company_id,NEW.id,root.kind,root.id
      FROM heartbeat_runs r JOIN context_manifests c ON c.company_id=r.company_id AND c.run_id=r.id AND c.agent_id=r.agent_id
      CROSS JOIN LATERAL (
        SELECT 'issue'::text AS kind,c.issue_id AS id WHERE c.issue_id IS NOT NULL
        UNION ALL SELECT 'project',c.project_id WHERE c.project_id IS NOT NULL
        UNION ALL SELECT 'issue',substring(item.source_ref FROM 9)::uuid FROM context_manifest_items item
          WHERE item.company_id=c.company_id AND item.manifest_id=c.id AND item.source_provider='august_works_tasks'
            AND item.source_ref ~* '^issue://[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
      ) root
      WHERE r.company_id=NEW.company_id AND r.id::text=NEW.origin_run_id
        AND NOT(root.kind='issue' AND root.id=NEW.id) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- Backfill retained Context roots from actual immutable run/Task bindings and
-- original copied-Task producer runs. Unknown/malformed Context refs remain
-- withheld by current native source checks; no public qualification is inferred.
INSERT INTO issue_privacy_sources(company_id,issue_id,source_kind,source_id)
 SELECT dest.company_id,dest.id,root.kind,root.id
 FROM issues dest JOIN heartbeat_runs r ON r.company_id=dest.company_id
   AND (r.issue_id=dest.id OR r.id::text=dest.origin_run_id)
 JOIN context_manifests c ON c.company_id=r.company_id AND c.run_id=r.id AND c.agent_id=r.agent_id
 CROSS JOIN LATERAL (
   SELECT 'issue'::text AS kind,c.issue_id AS id WHERE c.issue_id IS NOT NULL
   UNION ALL SELECT 'project',c.project_id WHERE c.project_id IS NOT NULL
   UNION ALL SELECT 'issue',substring(item.source_ref FROM 9)::uuid FROM context_manifest_items item
     WHERE item.company_id=c.company_id AND item.manifest_id=c.id AND item.source_provider='august_works_tasks'
       AND item.source_ref ~* '^issue://[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
 ) root WHERE NOT(root.kind='issue' AND root.id=dest.id) ON CONFLICT DO NOTHING;
