ALTER TABLE "memory_records" ADD COLUMN "source_provenance_qualified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "memory_records" ADD COLUMN "source_run_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "memory_records" ADD COLUMN "source_issue_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "memory_records" ADD COLUMN "source_project_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "memory_records" ADD COLUMN "source_memory_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "memory_records" ADD COLUMN "source_foundation_revision_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "source_issue_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "source_provenance_qualified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "memory_records" ADD CONSTRAINT "memory_records_source_bounds_check" CHECK (
      cardinality("memory_records"."source_run_ids") + cardinality("memory_records"."source_issue_ids") + cardinality("memory_records"."source_project_ids")
      + cardinality("memory_records"."source_memory_ids") + cardinality("memory_records"."source_foundation_revision_ids") <= 256);--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_source_bound_check" CHECK (cardinality("projects"."source_issue_ids") <= 256 and array_position("projects"."source_issue_ids",null) is null);
--> statement-breakpoint
-- Original Project provenance owner. Ordinary edits retain every actual source;
-- a deleted source remains a denied UUID rather than becoming public history.
CREATE FUNCTION aw_retain_project_privacy_sources() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  SELECT coalesce(array_agg(source_id ORDER BY source_id),'{}'::uuid[])
    INTO NEW.source_issue_ids
    FROM (SELECT DISTINCT unnest(OLD.source_issue_ids || NEW.source_issue_ids) AS source_id) retained;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER projects_retain_private_sources BEFORE UPDATE ON projects
 FOR EACH ROW EXECUTE FUNCTION aw_retain_project_privacy_sources();
--> statement-breakpoint
-- Original Memory source owner. Ordinary revisions/corroboration retain all
-- source identities. Payload erasure clears personal references; the surviving
-- deletion marker and unqualified row still prevent source-free resurrection.
CREATE FUNCTION aw_retain_memory_privacy_sources() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN
    NEW.source_provenance_qualified := false;
    NEW.source_run_ids := '{}'; NEW.source_issue_ids := '{}'; NEW.source_project_ids := '{}';
    NEW.source_memory_ids := '{}'; NEW.source_foundation_revision_ids := '{}';
    RETURN NEW;
  END IF;
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
--> statement-breakpoint
CREATE TRIGGER memory_records_retain_private_sources BEFORE UPDATE ON memory_records
 FOR EACH ROW EXECUTE FUNCTION aw_retain_memory_privacy_sources();
