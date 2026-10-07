CREATE TABLE "analytical_context_dependencies" (
	"company_id" uuid NOT NULL,
	"memory_record_id" uuid NOT NULL,
	"source_manifest_id" uuid NOT NULL,
	CONSTRAINT "analytical_context_dependencies_uq" UNIQUE("memory_record_id","source_manifest_id")
);
--> statement-breakpoint
CREATE TABLE "analytical_context_roots" (
	"company_id" uuid NOT NULL,
	"memory_record_id" uuid PRIMARY KEY NOT NULL,
	"source_count" integer NOT NULL,
	"content_hash" text NOT NULL,
	"deletion_key" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "analytical_context_roots_tenant_uq" UNIQUE("company_id","memory_record_id"),
	CONSTRAINT "analytical_context_roots_validity" CHECK ("analytical_context_roots"."source_count" between 1 and 32 and "analytical_context_roots"."content_hash" ~ '^[0-9a-f]{64}$' and "analytical_context_roots"."deletion_key" ~ '^[0-9a-f]{64}$' and "analytical_context_roots"."expires_at">"analytical_context_roots"."created_at")
);
--> statement-breakpoint
ALTER TABLE "analytical_context_dependencies" ADD CONSTRAINT "analytical_context_dependencies_root_fk" FOREIGN KEY ("company_id","memory_record_id") REFERENCES "public"."analytical_context_roots"("company_id","memory_record_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytical_context_dependencies" ADD CONSTRAINT "analytical_context_dependencies_source_fk" FOREIGN KEY ("company_id","source_manifest_id") REFERENCES "public"."analytical_lineage_manifests"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytical_context_roots" ADD CONSTRAINT "analytical_context_roots_memory_fk" FOREIGN KEY ("company_id","memory_record_id") REFERENCES "public"."memory_records"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analytical_context_dependencies_source_idx" ON "analytical_context_dependencies" USING btree ("company_id","source_manifest_id");--> statement-breakpoint
CREATE INDEX "analytical_context_roots_expiry_idx" ON "analytical_context_roots" USING btree ("company_id","expires_at");
--> statement-breakpoint
-- Deleting any original analytical source closes the whole consumed result.
-- The content-free C7 marker also wins over restored or late runtime writes.
CREATE FUNCTION aw_analytical_context_source_erased() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE root analytical_context_roots%ROWTYPE;
BEGIN
 SELECT * INTO root FROM analytical_context_roots WHERE company_id=OLD.company_id AND memory_record_id=OLD.memory_record_id;
 IF FOUND AND EXISTS(SELECT 1 FROM companies WHERE id=OLD.company_id) THEN
  INSERT INTO memory_deletion_markers(company_id,key,kind,record_id,deleted_at)
   VALUES(root.company_id,root.deletion_key,'record',root.memory_record_id,clock_timestamp()) ON CONFLICT DO NOTHING;
  UPDATE memory_records SET content='',title=NULL,summary=NULL,subject_type=NULL,subject_id=NULL,metadata='{}',deleted_at=coalesce(deleted_at,clock_timestamp()),updated_at=clock_timestamp(),retention_state='expired',review_state='rejected'
   WHERE company_id=root.company_id AND id=root.memory_record_id;
 END IF;
 RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER analytical_context_source_erased AFTER DELETE ON analytical_context_dependencies FOR EACH ROW EXECUTE FUNCTION aw_analytical_context_source_erased();
--> statement-breakpoint
CREATE FUNCTION aw_analytical_context_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Analytical retention provenance is immutable'; END $$;
--> statement-breakpoint
CREATE TRIGGER analytical_context_root_immutable BEFORE UPDATE ON analytical_context_roots FOR EACH ROW EXECUTE FUNCTION aw_analytical_context_immutable();
--> statement-breakpoint
CREATE TRIGGER analytical_context_dependency_immutable BEFORE UPDATE ON analytical_context_dependencies FOR EACH ROW EXECUTE FUNCTION aw_analytical_context_immutable();
--> statement-breakpoint
CREATE FUNCTION aw_analytical_context_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tenant uuid; record uuid; root analytical_context_roots%ROWTYPE;
BEGIN
 tenant=NEW.company_id; record=NEW.memory_record_id;
 SELECT * INTO root FROM analytical_context_roots WHERE company_id=tenant AND memory_record_id=record;
 IF FOUND AND EXISTS(SELECT 1 FROM memory_records m WHERE m.company_id=tenant AND m.id=record AND m.deleted_at IS NULL) THEN
  IF root.source_count<>(SELECT count(*) FROM analytical_context_dependencies d WHERE d.company_id=tenant AND d.memory_record_id=record)
   OR EXISTS(SELECT 1 FROM analytical_context_dependencies d JOIN analytical_lineage_manifests s ON s.company_id=d.company_id AND s.id=d.source_manifest_id WHERE d.company_id=tenant AND d.memory_record_id=record AND s.expires_at<root.expires_at)
   OR EXISTS(SELECT 1 FROM memory_records m WHERE m.company_id=tenant AND m.id=record AND (m.review_state<>'rejected' OR m.verification_state<>'unverified' OR m.memory_type<>'observation' OR m.expires_at IS DISTINCT FROM root.expires_at))
  THEN RAISE EXCEPTION 'Incomplete or misclassified analytical retention root'; END IF;
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER analytical_context_root_complete AFTER INSERT ON analytical_context_roots DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION aw_analytical_context_complete();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER analytical_context_dependency_complete AFTER INSERT ON analytical_context_dependencies DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION aw_analytical_context_complete();

--> statement-breakpoint
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
CREATE FUNCTION aw_analytical_memory_classification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.deleted_at IS NULL AND EXISTS(SELECT 1 FROM analytical_context_roots a WHERE a.company_id=NEW.company_id AND a.memory_record_id=NEW.id
  AND (NEW.review_state<>'rejected' OR NEW.verification_state<>'unverified' OR NEW.memory_type<>'observation' OR NEW.expires_at IS DISTINCT FROM a.expires_at))
 THEN RAISE EXCEPTION 'Analytical retention roots cannot become verified Task evidence'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER analytical_memory_classification BEFORE UPDATE ON memory_records FOR EACH ROW EXECUTE FUNCTION aw_analytical_memory_classification();
--> statement-breakpoint
CREATE FUNCTION aw_analytical_context_root_delete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM companies WHERE id=OLD.company_id AND content_erasure_transaction_id IS DISTINCT FROM pg_current_xact_id()::text) AND EXISTS(SELECT 1 FROM memory_records WHERE company_id=OLD.company_id AND id=OLD.memory_record_id AND deleted_at IS NULL) THEN
  RAISE EXCEPTION 'Retain analytical deletion provenance until company erasure';
 END IF;
 RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER analytical_context_root_delete_guard BEFORE DELETE ON analytical_context_roots FOR EACH ROW EXECUTE FUNCTION aw_analytical_context_root_delete_guard();
