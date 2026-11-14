ALTER TABLE "issue_privacy_sources" DROP CONSTRAINT "issue_privacy_sources_kind_check";--> statement-breakpoint
ALTER TABLE "issue_privacy_sources" ADD CONSTRAINT "issue_privacy_sources_kind_check" CHECK ("issue_privacy_sources"."source_kind" in ('issue','project','run','run_copy','workflow_run','routine_run'));--> statement-breakpoint
-- A run that produced a Native model output is retained for exact copy erasure;
-- its later Run/Context contents are not reader authority for that output.
CREATE OR REPLACE FUNCTION aw_record_task_privacy_sources() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_run uuid; source_task uuid; source_kind text; native_candidate boolean; native_output boolean;
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
    native_candidate := source_kind='run' AND NEW.payload_source_protocol_version=1
      AND NEW.created_by_agent_id IS NOT NULL
      AND (NEW.origin_id LIKE 'paperclip-runner:create-task:%' OR NEW.origin_id LIKE 'paperclip-suggested-task:%');
    native_output := native_candidate AND jsonb_typeof(NEW.payload_source_snapshot)='object'
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(case when jsonb_typeof(NEW.payload_source_snapshot->'inputs')='array'
          then NEW.payload_source_snapshot->'inputs' else '[]'::jsonb end) captured
        WHERE captured->>'kind'='worker_model_dispatch' AND captured->>'runId'=source_run::text);
    IF native_output THEN source_kind := 'run_copy'; END IF;
    IF source_kind='run' THEN
      SELECT coalesce(r.issue_id,r.native_issue_id) INTO source_task FROM heartbeat_runs r
        WHERE r.id=source_run AND r.company_id=NEW.company_id;
    END IF;
    IF source_kind<>'run' OR source_task IS DISTINCT FROM NEW.id THEN
      INSERT INTO issue_privacy_sources(company_id,issue_id,source_kind,source_id)
        VALUES(NEW.company_id,NEW.id,source_kind,source_run) ON CONFLICT DO NOTHING;
    END IF;
    -- A protocol-1 task can pass through an insert-before-snapshot phase. Keep
    -- its conservative Run read edge until an exact model-dispatch prefix is
    -- bound; then replace only the automatic producer edge. A retained_run
    -- listed in the captured read policy remains a real Run dependency.
    IF TG_OP='UPDATE' AND native_output AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(case when jsonb_typeof(NEW.payload_source_snapshot->'policy'->'runIds')='array'
        then NEW.payload_source_snapshot->'policy'->'runIds' else '[]'::jsonb end) retained(run_id)
      WHERE retained.run_id=source_run::text
    ) THEN
      DELETE FROM issue_privacy_sources edge WHERE edge.company_id=NEW.company_id AND edge.issue_id=NEW.id
        AND edge.source_kind='run' AND edge.source_id=source_run AND edge.context_manifest_id IS NULL;
    END IF;
    -- A qualified Native output's consumed roots are recorded by its original
    -- writer from the captured prefix; never attach later Context manifests.
    IF source_kind='run' AND NOT native_candidate THEN
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
DROP TRIGGER issues_record_private_sources ON public.issues;
--> statement-breakpoint
CREATE TRIGGER issues_record_private_sources AFTER INSERT OR UPDATE OF parent_id,privacy_parent_issue_id,project_id,origin_run_id,origin_kind,origin_id,payload_source_protocol_version,payload_source_snapshot ON public.issues
 FOR EACH ROW EXECUTE FUNCTION aw_record_task_privacy_sources();
--> statement-breakpoint
-- A payload snapshot records only the Context rows present in that exact
-- captured prefix. Later manifests for the producer Run remain separate.
CREATE OR REPLACE FUNCTION aw_record_native_payload_context_sources() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE captured_input jsonb; context_id uuid;
BEGIN
  IF NEW.payload_source_protocol_version<>1 OR jsonb_typeof(NEW.payload_source_snapshot) IS DISTINCT FROM 'object' THEN
    RETURN NEW;
  END IF;
  FOR captured_input IN SELECT value FROM jsonb_array_elements(NEW.payload_source_snapshot->'inputs')
    WHERE value->>'kind'='context' LOOP
    IF captured_input->>'manifestId' !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN CONTINUE; END IF;
    context_id := (captured_input->>'manifestId')::uuid;
    INSERT INTO issue_privacy_sources(company_id,issue_id,source_kind,source_id,context_manifest_id)
      SELECT NEW.company_id,NEW.id,'issue',c.issue_id,c.id FROM context_manifests c
      WHERE c.company_id=NEW.company_id AND c.id=context_id AND c.issue_id IS NOT NULL AND c.issue_id<>NEW.id
      ON CONFLICT DO NOTHING;
    INSERT INTO issue_privacy_sources(company_id,issue_id,source_kind,source_id,context_manifest_id)
      SELECT NEW.company_id,NEW.id,'issue',substring(item.source_ref FROM 9)::uuid,c.id
      FROM context_manifests c JOIN context_manifest_items item
        ON item.company_id=c.company_id AND item.manifest_id=c.id
      WHERE c.company_id=NEW.company_id AND c.id=context_id AND item.source_provider='august_works_tasks'
        AND item.source_ref ~* '^issue://[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
        AND substring(item.source_ref FROM 9)::uuid<>NEW.id
      ON CONFLICT DO NOTHING;
  END LOOP;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER issues_record_native_payload_context_sources AFTER INSERT OR UPDATE OF payload_source_snapshot ON public.issues
 FOR EACH ROW EXECUTE FUNCTION aw_record_native_payload_context_sources();
