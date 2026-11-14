ALTER TABLE "issue_privacy_sources" DROP CONSTRAINT "issue_privacy_sources_kind_check";--> statement-breakpoint
ALTER TABLE "issue_privacy_sources" ADD CONSTRAINT "issue_privacy_sources_kind_check" CHECK ("issue_privacy_sources"."source_kind" in ('issue','project','run','workflow_run','routine_run'));--> statement-breakpoint
-- Typed Task origins retain their original native execution namespace.
-- Historical 'run' sources are neither reclassified nor erased by this migration.
CREATE OR REPLACE FUNCTION aw_record_task_privacy_sources() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_run uuid; source_task uuid; source_kind text;
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
    source_kind := CASE NEW.origin_kind WHEN 'workflow_task' THEN 'workflow_run'
      WHEN 'routine_execution' THEN 'routine_run' ELSE 'run' END;
    IF source_kind='run' THEN
      SELECT coalesce(r.issue_id,r.native_issue_id) INTO source_task FROM heartbeat_runs r
        WHERE r.id=source_run AND r.company_id=NEW.company_id;
    END IF;
    -- Missing and foreign origins remain denied tombstones, not public defaults.
    IF source_kind<>'run' OR source_task IS DISTINCT FROM NEW.id THEN
      INSERT INTO issue_privacy_sources(company_id,issue_id,source_kind,source_id)
        VALUES(NEW.company_id,NEW.id,source_kind,source_run) ON CONFLICT DO NOTHING;
    END IF;
    IF source_kind='run' THEN
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
        WHERE r.company_id=NEW.company_id AND r.id=source_run
          AND NOT(root.kind='issue' AND root.id=NEW.id) ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER issues_record_private_sources ON issues;
--> statement-breakpoint
CREATE TRIGGER issues_record_private_sources AFTER INSERT OR UPDATE OF parent_id,privacy_parent_issue_id,project_id,origin_run_id,origin_kind,origin_id ON issues
 FOR EACH ROW EXECUTE FUNCTION aw_record_task_privacy_sources();
