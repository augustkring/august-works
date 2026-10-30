ALTER TABLE "heartbeat_runs" ADD COLUMN "source_context_manifest_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ADD COLUMN "source_context_provenance_qualified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "memory_records" ADD COLUMN "private_owner_user_id" text;--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ADD CONSTRAINT "heartbeat_runs_source_context_bounds_check" CHECK (cardinality("heartbeat_runs"."source_context_manifest_ids") <= 64
      and array_position("heartbeat_runs"."source_context_manifest_ids",null) is null);
--> statement-breakpoint
-- Original Run source capture. Ordinary updates may revoke qualification,
-- never manufacture historical completeness or discard a retained Context UUID.
CREATE FUNCTION aw_retain_run_context_sources() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.source_context_provenance_qualified := OLD.source_context_provenance_qualified AND NEW.source_context_provenance_qualified;
  SELECT coalesce(array_agg(id ORDER BY id),'{}'::uuid[]) INTO NEW.source_context_manifest_ids
    FROM (SELECT DISTINCT unnest(OLD.source_context_manifest_ids || NEW.source_context_manifest_ids) id) retained;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER heartbeat_runs_retain_context_sources BEFORE UPDATE OF source_context_manifest_ids,source_context_provenance_qualified
 ON heartbeat_runs FOR EACH ROW EXECUTE FUNCTION aw_retain_run_context_sources();
--> statement-breakpoint
-- Every newly persisted Context records its actual native run identity. These
-- UUIDs narrow reads after erasure; they supply no actor/company authority.
CREATE FUNCTION aw_capture_run_context_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actual_run uuid;
BEGIN
  IF NEW.run_id IS NULL THEN RETURN NEW; END IF;
  UPDATE heartbeat_runs SET source_context_manifest_ids=source_context_manifest_ids || ARRAY[NEW.id]
    WHERE company_id=NEW.company_id AND id=NEW.run_id AND agent_id=NEW.agent_id RETURNING id INTO actual_run;
  IF actual_run IS NULL THEN RAISE EXCEPTION 'Context run identity is unavailable'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER context_manifests_capture_run_source AFTER INSERT ON context_manifests
 FOR EACH ROW EXECUTE FUNCTION aw_capture_run_context_source();
--> statement-breakpoint
-- Recover known references without claiming complete historical provenance.
-- Over-budget/unknown history stays unqualified; no absence-based public backfill.
WITH candidates AS (
 SELECT c.run_id AS run_id,c.id AS source_id FROM context_manifests c JOIN heartbeat_runs r
   ON r.company_id=c.company_id AND r.id=c.run_id AND r.agent_id=c.agent_id
 UNION SELECT e.run_id,e.context_manifest_id FROM agent_execution_manifests e
 UNION SELECT e.run_id,(ref.value->>'contextManifestId')::uuid FROM agent_execution_manifests e
   CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(e.manifest->'contextManifests')='array' THEN e.manifest->'contextManifests' ELSE '[]'::jsonb END) ref
   WHERE ref.value->>'contextManifestId' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
 UNION SELECT e.run_id,(ref.value->>'contextManifestId')::uuid FROM agent_execution_authorizations a
   JOIN agent_execution_manifests e ON e.company_id=a.company_id AND e.id=a.manifest_id
   CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(a.context_manifest_refs)='array' THEN a.context_manifest_refs ELSE '[]'::jsonb END) ref
   WHERE ref.value->>'contextManifestId' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
), roots AS (SELECT run_id,array_agg(source_id ORDER BY source_id) AS ids FROM candidates GROUP BY run_id)
UPDATE heartbeat_runs r SET source_context_manifest_ids=roots.ids FROM roots WHERE r.id=roots.run_id AND cardinality(roots.ids)<=64;

--> statement-breakpoint
-- Private Memory binds the actual Human at capture. Native steering changes
-- the run identity, never this original scope. Erasure clears personal refs.
CREATE OR REPLACE FUNCTION aw_retain_memory_privacy_sources() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN
    NEW.private_owner_user_id := NULL;
    NEW.source_provenance_qualified := false;
    NEW.source_run_ids := '{}'; NEW.source_issue_ids := '{}'; NEW.source_project_ids := '{}';
    NEW.source_memory_ids := '{}'; NEW.source_foundation_revision_ids := '{}';
    RETURN NEW;
  END IF;
  IF OLD.scope_type='agent' AND (NEW.scope_type IS DISTINCT FROM OLD.scope_type
      OR NEW.scope_id IS DISTINCT FROM OLD.scope_id OR NEW.owner_agent_id IS DISTINCT FROM OLD.owner_agent_id) THEN
    RAISE EXCEPTION 'private Memory scope identity is immutable';
  END IF;
  NEW.private_owner_user_id := OLD.private_owner_user_id;
  NEW.source_provenance_qualified := OLD.source_provenance_qualified;
  SELECT coalesce(array_agg(id ORDER BY id),'{}'::uuid[]) INTO NEW.source_run_ids
    FROM (SELECT DISTINCT unnest(OLD.source_run_ids || NEW.source_run_ids) id) retained;
  SELECT coalesce(array_agg(id ORDER BY id),'{}'::uuid[]) INTO NEW.source_issue_ids
    FROM (SELECT DISTINCT unnest(OLD.source_issue_ids || NEW.source_issue_ids) id) retained;
  SELECT coalesce(array_agg(id ORDER BY id),'{}'::uuid[]) INTO NEW.source_project_ids
    FROM (SELECT DISTINCT unnest(OLD.source_project_ids || NEW.source_project_ids) id) retained;
  SELECT coalesce(array_agg(id ORDER BY id),'{}'::uuid[]) INTO NEW.source_memory_ids
    FROM (SELECT DISTINCT unnest(OLD.source_memory_ids || NEW.source_memory_ids) id) retained;
  SELECT coalesce(array_agg(id ORDER BY id),'{}'::uuid[]) INTO NEW.source_foundation_revision_ids
    FROM (SELECT DISTINCT unnest(OLD.source_foundation_revision_ids || NEW.source_foundation_revision_ids) id) retained;
  RETURN NEW;
END $$;
