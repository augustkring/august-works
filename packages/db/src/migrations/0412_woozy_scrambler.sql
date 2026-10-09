CREATE TABLE "management_review_governance_dependencies" (
	"company_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"obligation_id" uuid NOT NULL,
	CONSTRAINT "management_review_governance_dependencies_source_uq" UNIQUE("company_id","review_id","obligation_id")
);
--> statement-breakpoint
ALTER TABLE "management_review_governance_dependencies" ADD CONSTRAINT "management_review_governance_dependencies_review_fk" FOREIGN KEY ("company_id","review_id") REFERENCES "public"."management_review_snapshots"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_review_governance_dependencies" ADD CONSTRAINT "management_review_governance_dependencies_source_fk" FOREIGN KEY ("company_id","obligation_id") REFERENCES "public"."governance_obligations"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "management_review_governance_dependencies_source_idx" ON "management_review_governance_dependencies" USING btree ("company_id","obligation_id");
--> statement-breakpoint
-- The expected roots are derived from the already signed immutable definition.
-- Backfill preserves every existing historical receipt without re-signing it.
CREATE FUNCTION aw_management_governance_roots(definition jsonb) RETURNS TABLE(obligation_id uuid)
 LANGUAGE sql IMMUTABLE AS $$
 SELECT DISTINCT ref::uuid FROM (
  SELECT jsonb_array_elements_text(definition->'governanceObligationRefs') AS ref
  UNION ALL SELECT pin->'source'->>'id' FROM jsonb_array_elements(definition->'sources') pin
    WHERE pin->'source'->>'kind'='governance_obligation'
 ) roots
$$;
--> statement-breakpoint
-- A historical copy with an already missing native root cannot be repaired by
-- fabricating a dependency. Erase through its existing manifest owner instead.
DELETE FROM analytical_lineage_manifests m USING management_review_snapshots r
 WHERE m.company_id=r.company_id AND m.id=r.lineage_manifest_id
 AND EXISTS(SELECT 1 FROM aw_management_governance_roots(r.definition_json) expected
   WHERE NOT EXISTS(SELECT 1 FROM governance_obligations g WHERE g.company_id=r.company_id AND g.id=expected.obligation_id));
--> statement-breakpoint
INSERT INTO management_review_governance_dependencies(company_id,review_id,obligation_id)
 SELECT r.company_id,r.id,expected.obligation_id FROM management_review_snapshots r
 CROSS JOIN LATERAL aw_management_governance_roots(r.definition_json) expected;
--> statement-breakpoint
CREATE TRIGGER management_review_governance_erased AFTER DELETE ON management_review_governance_dependencies
 FOR EACH ROW EXECUTE FUNCTION aw_management_dependency_erased();
--> statement-breakpoint
CREATE TRIGGER management_review_governance_update_immutable BEFORE UPDATE ON management_review_governance_dependencies
 FOR EACH ROW EXECUTE FUNCTION aw_management_review_child_immutable();
--> statement-breakpoint
CREATE FUNCTION aw_management_governance_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM management_review_snapshots r
   CROSS JOIN LATERAL aw_management_governance_roots(r.definition_json) expected
   WHERE r.company_id=NEW.company_id AND r.id=NEW.review_id AND expected.obligation_id=NEW.obligation_id)
   THEN RAISE EXCEPTION 'management_governance_signed_root_required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER management_review_governance_insert BEFORE INSERT ON management_review_governance_dependencies
 FOR EACH ROW EXECUTE FUNCTION aw_management_governance_insert_guard();
--> statement-breakpoint
CREATE FUNCTION aw_management_governance_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected uuid[]; actual uuid[];
BEGIN
 IF NOT EXISTS(SELECT 1 FROM management_review_snapshots WHERE company_id=NEW.company_id AND id=NEW.id) THEN RETURN NEW; END IF;
 SELECT array_agg(obligation_id ORDER BY obligation_id) INTO expected FROM aw_management_governance_roots(NEW.definition_json);
 SELECT array_agg(obligation_id ORDER BY obligation_id) INTO actual FROM management_review_governance_dependencies WHERE company_id=NEW.company_id AND review_id=NEW.id;
 IF expected IS NULL OR cardinality(expected) NOT BETWEEN 1 AND 36 OR expected IS DISTINCT FROM actual
   THEN RAISE EXCEPTION 'management_governance_dependencies_incomplete' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER management_review_governance_complete AFTER INSERT ON management_review_snapshots
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION aw_management_governance_complete();
