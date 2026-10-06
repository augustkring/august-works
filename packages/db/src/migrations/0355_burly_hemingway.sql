CREATE TABLE "context_manifest_memory_roots" (
	"company_id" uuid NOT NULL,
	"manifest_id" uuid NOT NULL,
	"memory_record_id" uuid NOT NULL,
	"source_version" text NOT NULL,
	CONSTRAINT "context_memory_roots_manifest_record_uq" UNIQUE("manifest_id","memory_record_id")
);
--> statement-breakpoint
ALTER TABLE "context_manifest_memory_roots" ADD CONSTRAINT "context_manifest_memory_roots_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_manifest_memory_roots" ADD CONSTRAINT "context_memory_roots_manifest_fk" FOREIGN KEY ("company_id","manifest_id") REFERENCES "public"."context_manifests"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_manifest_memory_roots" ADD CONSTRAINT "context_memory_roots_memory_fk" FOREIGN KEY ("company_id","memory_record_id") REFERENCES "public"."memory_records"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "context_memory_roots_company_record_idx" ON "context_manifest_memory_roots" USING btree ("company_id","memory_record_id");
--> statement-breakpoint
-- Content-free deletion provenance overrides restored or late agent writes.
CREATE OR REPLACE FUNCTION aw_workflow_memory_erased(company uuid, execution uuid, task uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
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
  );
$$;

