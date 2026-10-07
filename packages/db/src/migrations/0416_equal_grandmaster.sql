ALTER TABLE "issues" ADD COLUMN "conversation_retired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_conversation_retirement_check" CHECK ("issues"."conversation_retired_at" is null or (
      "issues"."conversation_agent_id" is null and "issues"."conversation_user_id" is null and "issues"."conversation_state" is null
      and "issues"."status" = 'cancelled' and "issues"."hidden_at" is not null
      and "issues"."assignee_agent_id" is null and "issues"."assignee_user_id" is null
      and "issues"."execution_run_id" is null and "issues"."checkout_run_id" is null
    ));
--> statement-breakpoint
-- Keep the retired native conversation closed even after retention provenance GC.
CREATE OR REPLACE FUNCTION aw_workflow_memory_erased(company uuid, execution uuid, task uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM issues i WHERE i.company_id=company AND i.conversation_retired_at IS NOT NULL
    AND ((task IS NOT NULL AND i.id=task) OR (execution IS NOT NULL AND EXISTS(SELECT 1 FROM heartbeat_runs h WHERE h.company_id=company AND h.id=execution AND h.native_issue_id=i.id))))
  OR EXISTS (
    SELECT 1 FROM workflow_step_runs s
    CROSS JOIN LATERAL jsonb_array_elements_text(s.memory_record_ids) ref(id)
    WHERE s.company_id = company
      AND ((execution IS NOT NULL AND (s.heartbeat_run_id = execution OR EXISTS (
        SELECT 1 FROM heartbeat_runs h JOIN agent_wakeup_requests a ON a.company_id = h.company_id AND a.id = h.wakeup_request_id
        WHERE h.company_id = company AND h.id = execution AND (
          a.idempotency_key = 'workflow-direct-agent:' || s.id::text OR EXISTS (
            SELECT 1 FROM workflow_waits w WHERE w.company_id = company AND w.workflow_run_id = s.workflow_run_id
              AND w.node_id = s.node_id AND w.reference_type = 'issue' AND w.reference_id = a.payload->>'issueId')))))
        OR (task IS NOT NULL AND EXISTS (
          SELECT 1 FROM workflow_waits w WHERE w.company_id = company
            AND w.workflow_run_id = s.workflow_run_id AND w.node_id = s.node_id
            AND w.reference_type = 'issue' AND w.reference_id = task::text)))
      AND (NOT EXISTS (SELECT 1 FROM memory_records r
        WHERE r.company_id = company AND r.id::text = ref.id AND r.deleted_at IS NULL)
        OR EXISTS (SELECT 1 FROM memory_deletion_markers m
          WHERE m.company_id = company AND m.record_id::text = ref.id))
  )
  OR EXISTS (
    SELECT 1 FROM context_manifest_memory_roots r
    JOIN context_manifests c ON c.company_id = r.company_id AND c.id = r.manifest_id
    WHERE r.company_id = company
      AND ((execution IS NOT NULL AND c.run_id = execution) OR (task IS NOT NULL AND c.issue_id = task))
      AND (EXISTS (SELECT 1 FROM memory_deletion_markers m WHERE m.company_id = company AND m.record_id = r.memory_record_id)
        OR NOT EXISTS (SELECT 1 FROM memory_records source WHERE source.company_id = company AND source.id = r.memory_record_id AND source.deleted_at IS NULL))
  )
  OR EXISTS (
    SELECT 1 FROM context_manifest_memory_roots r
    JOIN context_manifests c ON c.company_id=r.company_id AND c.id=r.manifest_id
    JOIN analytical_context_roots a ON a.company_id=r.company_id AND a.memory_record_id=r.memory_record_id
    WHERE r.company_id=company AND ((execution IS NOT NULL AND c.run_id=execution) OR (task IS NOT NULL AND c.issue_id=task))
      AND (a.expires_at<=now() OR a.source_count<>(SELECT count(*) FROM analytical_context_dependencies d WHERE d.company_id=a.company_id AND d.memory_record_id=a.memory_record_id)
        OR EXISTS(SELECT 1 FROM analytical_context_dependencies d JOIN analytical_lineage_manifests s ON s.company_id=d.company_id AND s.id=d.source_manifest_id WHERE d.company_id=a.company_id AND d.memory_record_id=a.memory_record_id AND s.expires_at<=now()))
  );
$$;
--> statement-breakpoint
CREATE FUNCTION aw_native_conversation_retirement_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.conversation_retired_at IS NOT NULL AND NEW.conversation_retired_at IS DISTINCT FROM OLD.conversation_retired_at THEN
  RAISE EXCEPTION 'Native conversation retirement is irreversible' USING ERRCODE='23514', CONSTRAINT='issues_conversation_retirement_check';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER native_conversation_retirement_immutable BEFORE UPDATE ON issues FOR EACH ROW EXECUTE FUNCTION aw_native_conversation_retirement_immutable();
