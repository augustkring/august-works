-- Human-approved standalone tasks inherit the actual Original interaction/run
-- source. A copied origin string is never a reader or approval grant.
CREATE FUNCTION aw_runner_task_origin(company uuid, task uuid)
RETURNS TABLE(source_run_id uuid, source_task_id uuid, invalid boolean)
LANGUAGE sql STABLE AS $$
 SELECT h.id,h.native_issue_id,
   CASE WHEN t.origin_id LIKE 'paperclip-runner:create-task:%' THEN
     NOT coalesce(h.runtime_mode='native' AND h.native_issue_id IS NOT NULL
       AND h.agent_id=t.created_by_agent_id
       AND t.origin_id LIKE 'paperclip-runner:create-task:'||h.native_issue_id::text||':%',false)
   ELSE NOT EXISTS (
     SELECT 1 FROM issue_thread_interactions i
     WHERE i.company_id=t.company_id AND t.origin_id='paperclip-suggested-task:'||i.id::text
       AND i.kind='suggest_tasks' AND i.status='accepted' AND i.requested_resolver_policy='human_only'
       AND i.resolved_by_user_id IS NOT NULL AND i.resolved_by_user_id=t.created_by_user_id
       AND i.resolved_by_agent_id IS NULL AND t.created_by_agent_id IS NULL
       AND h.runtime_mode='native' AND h.native_issue_id=i.issue_id AND h.id=i.source_run_id
       AND EXISTS (
         SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(i.result->'createdTasks')='array'
           THEN i.result->'createdTasks' ELSE '[]'::jsonb END) receipt
         WHERE receipt->>'issueId'=t.id::text AND EXISTS (
           SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(i.payload->'tasks')='array'
             THEN i.payload->'tasks' ELSE '[]'::jsonb END) proposed
           WHERE proposed->>'clientKey'=receipt->>'clientKey' AND proposed->>'placement'='company_backlog'
         )
       )
   ) END
 FROM issues t LEFT JOIN heartbeat_runs h ON h.company_id=t.company_id AND h.id=CASE
   WHEN t.origin_run_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
   THEN t.origin_run_id::uuid ELSE NULL END
 WHERE t.company_id=company AND t.id=task AND t.origin_kind='manual'
   AND (t.origin_id LIKE 'paperclip-runner:create-task:%' OR t.origin_id LIKE 'paperclip-suggested-task:%')
$$;
--> statement-breakpoint
-- Preserve the existing 16-hop Native bound, including cycles, missing owners
-- and mixed Agent-created/Human-reviewed ancestry. All erasure/read owners
-- already consume this function; none infer a current privilege from provenance.
CREATE OR REPLACE FUNCTION aw_runner_task_source_chain(company uuid, execution uuid, task uuid)
RETURNS TABLE(source_run_id uuid, source_task_id uuid, invalid boolean)
LANGUAGE sql STABLE AS $$
 WITH RECURSIVE lineage AS (
   SELECT o.source_run_id,o.source_task_id,1 AS depth,ARRAY[t.id] AS path,o.invalid
   FROM issues t CROSS JOIN LATERAL aw_runner_task_origin(company,t.id) o
   WHERE t.company_id=company AND t.id=coalesce(task,(SELECT r.native_issue_id FROM heartbeat_runs r
     WHERE r.company_id=company AND r.id=execution AND r.runtime_mode='native'))
   UNION ALL
   SELECT o.source_run_id,o.source_task_id,l.depth+1,l.path||t.id,o.invalid
   FROM lineage l JOIN issues t ON t.company_id=company AND t.id=l.source_task_id
   CROSS JOIN LATERAL aw_runner_task_origin(company,t.id) o
   WHERE l.depth<16 AND NOT l.invalid AND NOT l.source_task_id=ANY(l.path)
 )
 SELECT l.source_run_id,l.source_task_id,l.invalid OR l.source_task_id=ANY(l.path)
   OR (l.depth=16 AND EXISTS(SELECT 1 FROM aw_runner_task_origin(company,l.source_task_id)))
 FROM lineage l
$$;
