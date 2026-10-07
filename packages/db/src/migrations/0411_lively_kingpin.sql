CREATE TABLE "management_review_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"item_key" text NOT NULL,
	"event" text NOT NULL,
	"rationale" text NOT NULL,
	"recorded_by" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"ordinal" integer NOT NULL,
	"content_hash" text NOT NULL,
	"signature" text NOT NULL,
	CONSTRAINT "management_review_events_ordinal_uq" UNIQUE("company_id","review_id","ordinal"),
	CONSTRAINT "management_review_events_content_check" CHECK ("management_review_events"."ordinal" between 1 and 100 and "management_review_events"."item_key" ~ '^[a-z][a-z0-9_-]{0,79}$' and "management_review_events"."event" in ('opened','ignored','acted_on','false_alarm','correction') and length(btrim("management_review_events"."rationale")) between 10 and 2000 and "management_review_events"."content_hash" ~ '^[a-f0-9]{64}$' and "management_review_events"."signature" ~ '^decision-spec-v1[.][a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "management_review_manifest_dependencies" (
	"company_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"source_manifest_id" uuid NOT NULL,
	CONSTRAINT "management_review_manifest_dependencies_source_uq" UNIQUE("company_id","review_id","source_manifest_id")
);
--> statement-breakpoint
CREATE TABLE "management_review_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"definition_json" jsonb NOT NULL,
	"sources_json" jsonb NOT NULL,
	"content_json" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"lineage_manifest_id" uuid NOT NULL,
	"signature" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"published_by" text,
	"published_at" timestamp with time zone,
	"publication_rationale" text,
	"publication_signature" text,
	"supersedes_id" uuid,
	CONSTRAINT "management_review_snapshots_tenant_uq" UNIQUE("company_id","id"),
	CONSTRAINT "management_review_snapshots_content_check" CHECK ("management_review_snapshots"."content_hash" ~ '^[a-f0-9]{64}$' and "management_review_snapshots"."signature" ~ '^decision-spec-v1[.][a-f0-9]{64}$' and jsonb_typeof("management_review_snapshots"."definition_json")='object' and jsonb_typeof("management_review_snapshots"."sources_json")='array' and jsonb_array_length("management_review_snapshots"."sources_json") between 1 and 20 and jsonb_typeof("management_review_snapshots"."content_json")='object' and "management_review_snapshots"."content_json"->>'contentHash'="management_review_snapshots"."content_hash" and "management_review_snapshots"."expires_at">"management_review_snapshots"."created_at"),
	CONSTRAINT "management_review_snapshots_state_check" CHECK (("management_review_snapshots"."status"='draft' and "management_review_snapshots"."published_by" is null and "management_review_snapshots"."published_at" is null and "management_review_snapshots"."publication_rationale" is null and "management_review_snapshots"."publication_signature" is null and "management_review_snapshots"."supersedes_id" is null) or ("management_review_snapshots"."status" in ('published','superseded') and "management_review_snapshots"."published_by" is not null and "management_review_snapshots"."published_at" is not null and length(btrim("management_review_snapshots"."publication_rationale")) between 10 and 2000 and "management_review_snapshots"."publication_signature" ~ '^decision-spec-v1[.][a-f0-9]{64}$' and "management_review_snapshots"."published_at">="management_review_snapshots"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "management_review_source_links" (
	"company_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_ref" uuid NOT NULL,
	"source_hash" text NOT NULL,
	CONSTRAINT "management_review_source_links_source_uq" UNIQUE("company_id","review_id","source_type","source_ref"),
	CONSTRAINT "management_review_source_links_source_check" CHECK ("management_review_source_links"."source_type" in ('issue','project','goal','document','document_revision','learning_cycle') and "management_review_source_links"."source_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "management_review_events" ADD CONSTRAINT "management_review_events_review_fk" FOREIGN KEY ("company_id","review_id") REFERENCES "public"."management_review_snapshots"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_review_manifest_dependencies" ADD CONSTRAINT "management_review_manifest_dependencies_review_fk" FOREIGN KEY ("company_id","review_id") REFERENCES "public"."management_review_snapshots"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_review_manifest_dependencies" ADD CONSTRAINT "management_review_manifest_dependencies_source_fk" FOREIGN KEY ("company_id","source_manifest_id") REFERENCES "public"."analytical_lineage_manifests"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_review_snapshots" ADD CONSTRAINT "management_review_snapshots_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_review_snapshots" ADD CONSTRAINT "management_review_snapshots_manifest_fk" FOREIGN KEY ("company_id","lineage_manifest_id") REFERENCES "public"."analytical_lineage_manifests"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_review_source_links" ADD CONSTRAINT "management_review_source_links_review_fk" FOREIGN KEY ("company_id","review_id") REFERENCES "public"."management_review_snapshots"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "management_review_snapshots_company_time_idx" ON "management_review_snapshots" USING btree ("company_id","created_at","id");--> statement-breakpoint
CREATE INDEX "management_review_source_links_source_idx" ON "management_review_source_links" USING btree ("company_id","source_type","source_ref");--> statement-breakpoint
-- Losing any original analytical manifest erases the entire copied review,
-- including all agenda/event/publication prose. Never retain a favourable subset.
CREATE FUNCTION aw_management_dependency_erased() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 DELETE FROM analytical_lineage_manifests m USING management_review_snapshots r
 WHERE r.company_id=OLD.company_id AND r.id=OLD.review_id
   AND m.company_id=r.company_id AND m.id=r.lineage_manifest_id;
 RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER management_review_dependency_erased AFTER DELETE ON management_review_manifest_dependencies
 FOR EACH ROW EXECUTE FUNCTION aw_management_dependency_erased();
--> statement-breakpoint
CREATE FUNCTION aw_management_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m analytical_lineage_manifests%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM analytical_lineage_manifests WHERE company_id=OLD.company_id AND id=OLD.lineage_manifest_id)
    AND NOT aw_company_content_erasure_current(OLD.company_id) THEN RAISE EXCEPTION 'management_review_delete_through_manifest_owner' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 END IF;
 SELECT * INTO m FROM analytical_lineage_manifests WHERE company_id=NEW.company_id AND id=NEW.lineage_manifest_id;
 IF NOT FOUND OR m.analysis_type IS DISTINCT FROM 'management_review_snapshot' OR m.analysis_ref IS DISTINCT FROM NEW.id OR m.created_at IS DISTINCT FROM NEW.created_at
   OR m.expires_at IS DISTINCT FROM NEW.expires_at OR m.definition_hash IS DISTINCT FROM (NEW.content_json->>'definitionHash')
   OR m.input_hash IS DISTINCT FROM (NEW.content_json->>'inputHash') OR m.engine_version IS DISTINCT FROM 'aw-native-management-skeleton-v1'
   OR (NEW.content_json->>'asOf')::timestamptz IS DISTINCT FROM NEW.created_at
   OR NEW.content_json->>'executionAuthority' IS DISTINCT FROM 'read_only_historical_review' THEN RAISE EXCEPTION 'management_review_manifest_binding' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'draft' OR NEW.expires_at<=statement_timestamp() OR NEW.created_by LIKE 'agent:%'
    OR jsonb_array_length(NEW.definition_json->'sources')<>jsonb_array_length(NEW.sources_json)
    OR jsonb_array_length(NEW.content_json->'agenda') NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'management_review_initial_state' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF ROW(NEW.id,NEW.company_id,NEW.definition_json,NEW.sources_json,NEW.content_json,NEW.content_hash,NEW.lineage_manifest_id,NEW.signature,NEW.created_by,NEW.created_at,NEW.expires_at)
   IS DISTINCT FROM ROW(OLD.id,OLD.company_id,OLD.definition_json,OLD.sources_json,OLD.content_json,OLD.content_hash,OLD.lineage_manifest_id,OLD.signature,OLD.created_by,OLD.created_at,OLD.expires_at) THEN RAISE EXCEPTION 'management_review_material_immutable' USING ERRCODE='23514'; END IF;
 IF OLD.status='draft' AND NEW.status='published' THEN
  IF NEW.expires_at<=statement_timestamp() OR NEW.published_by LIKE 'agent:%'
    OR (NEW.supersedes_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM management_review_snapshots s WHERE s.company_id=NEW.company_id AND s.id=NEW.supersedes_id AND s.id<>NEW.id AND s.status='published')) THEN RAISE EXCEPTION 'management_review_publication_state' USING ERRCODE='23514'; END IF;
 ELSIF OLD.status='published' AND NEW.status='superseded' THEN
  IF ROW(NEW.published_by,NEW.published_at,NEW.publication_rationale,NEW.publication_signature,NEW.supersedes_id) IS DISTINCT FROM ROW(OLD.published_by,OLD.published_at,OLD.publication_rationale,OLD.publication_signature,OLD.supersedes_id)
    OR NOT EXISTS(SELECT 1 FROM management_review_snapshots s WHERE s.company_id=NEW.company_id AND s.supersedes_id=NEW.id AND s.status='published') THEN RAISE EXCEPTION 'management_review_supersession_state' USING ERRCODE='23514'; END IF;
 ELSE RAISE EXCEPTION 'management_review_transition_unavailable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER management_review_snapshot_guard BEFORE INSERT OR UPDATE OR DELETE ON management_review_snapshots
 FOR EACH ROW EXECUTE FUNCTION aw_management_review_guard();
--> statement-breakpoint
CREATE FUNCTION aw_management_review_lineage_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m analytical_lineage_manifests%ROWTYPE;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM management_review_snapshots WHERE company_id=NEW.company_id AND id=NEW.id) THEN RETURN NEW; END IF;
 SELECT * INTO m FROM analytical_lineage_manifests WHERE company_id=NEW.company_id AND id=NEW.lineage_manifest_id;
 IF NOT (m.parameters_json ?& ARRAY['primitiveCount','dependencyCount','signature']) OR m.source_count<>(SELECT count(*) FROM analytical_lineage_edges WHERE company_id=NEW.company_id AND manifest_id=m.id)
   OR (m.parameters_json->>'primitiveCount')::integer<>(SELECT count(*) FROM management_review_source_links WHERE company_id=NEW.company_id AND review_id=NEW.id)
   OR (m.parameters_json->>'dependencyCount')::integer<>(SELECT count(*) FROM management_review_manifest_dependencies WHERE company_id=NEW.company_id AND review_id=NEW.id)
   THEN RAISE EXCEPTION 'management_review_lineage_incomplete' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER management_review_complete AFTER INSERT ON management_review_snapshots
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION aw_management_review_lineage_complete();
--> statement-breakpoint
CREATE FUNCTION aw_management_review_child_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'management_review_child_immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' AND EXISTS(SELECT 1 FROM management_review_snapshots WHERE company_id=OLD.company_id AND id=OLD.review_id)
   AND NOT aw_company_content_erasure_current(OLD.company_id) THEN RAISE EXCEPTION 'management_review_child_delete_through_owner' USING ERRCODE='23514'; END IF;
 RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER management_review_source_immutable BEFORE UPDATE OR DELETE ON management_review_source_links FOR EACH ROW EXECUTE FUNCTION aw_management_review_child_immutable();
--> statement-breakpoint
CREATE TRIGGER management_review_event_immutable BEFORE UPDATE OR DELETE ON management_review_events FOR EACH ROW EXECUTE FUNCTION aw_management_review_child_immutable();

--> statement-breakpoint
CREATE TRIGGER management_review_dependency_update_immutable BEFORE UPDATE ON management_review_manifest_dependencies FOR EACH ROW EXECUTE FUNCTION aw_management_review_child_immutable();
--> statement-breakpoint
CREATE FUNCTION aw_management_event_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.recorded_by LIKE 'agent:%' OR NOT EXISTS(SELECT 1 FROM management_review_snapshots r
   WHERE r.company_id=NEW.company_id AND r.id=NEW.review_id AND r.status in ('published','superseded')
   AND r.expires_at>statement_timestamp() AND NEW.recorded_at>=r.published_at
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(r.definition_json->'agenda') a WHERE a->>'key'=NEW.item_key))
   OR NEW.ordinal<>(SELECT coalesce(max(ordinal),0)+1 FROM management_review_events WHERE company_id=NEW.company_id AND review_id=NEW.review_id)
   THEN RAISE EXCEPTION 'management_human_event_binding' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER management_event_insert_guard BEFORE INSERT ON management_review_events FOR EACH ROW EXECUTE FUNCTION aw_management_event_insert_guard();
