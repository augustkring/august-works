CREATE TABLE "strategy_execution_link_approvals" (
	"company_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"approved_by" text NOT NULL,
	"rationale" text NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "strategy_approvals_version_uq" UNIQUE("company_id","link_id","version_id")
);
--> statement-breakpoint
CREATE TABLE "strategy_execution_link_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"definition_json" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"created_by" text NOT NULL,
	"next_review_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"from_foundation_section_version_id" uuid GENERATED ALWAYS AS (case when definition_json->'from'->>'type'='foundation_section' then (definition_json->'from'->>'approvedRevisionId')::uuid end) STORED,
	"from_metric_version_id" uuid GENERATED ALWAYS AS (case when definition_json->'from'->>'type'='metric' then (definition_json->'from'->>'versionId')::uuid end) STORED,
	"from_metric_target_version_id" uuid GENERATED ALWAYS AS (case when definition_json->'from'->>'type'='metric_target' then (definition_json->'from'->>'versionId')::uuid end) STORED,
	"to_foundation_section_version_id" uuid GENERATED ALWAYS AS (case when definition_json->'to'->>'type'='foundation_section' then (definition_json->'to'->>'approvedRevisionId')::uuid end) STORED,
	"to_metric_version_id" uuid GENERATED ALWAYS AS (case when definition_json->'to'->>'type'='metric' then (definition_json->'to'->>'versionId')::uuid end) STORED,
	"to_metric_target_version_id" uuid GENERATED ALWAYS AS (case when definition_json->'to'->>'type'='metric_target' then (definition_json->'to'->>'versionId')::uuid end) STORED,
	CONSTRAINT "strategy_versions_tenant_id_uq" UNIQUE("company_id","link_id","id"),
	CONSTRAINT "strategy_versions_revision_uq" UNIQUE("company_id","link_id","revision"),
	CONSTRAINT "strategy_versions_definition_check" CHECK ("strategy_execution_link_versions"."content_hash" ~ '^[0-9a-f]{64}$' and "strategy_execution_link_versions"."revision">0 and jsonb_typeof("strategy_execution_link_versions"."definition_json")='object' and "strategy_execution_link_versions"."expires_at">"strategy_execution_link_versions"."created_at" and "strategy_execution_link_versions"."next_review_at">"strategy_execution_link_versions"."created_at")
);
--> statement-breakpoint
CREATE TABLE "strategy_execution_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"from_type" text NOT NULL,
	"from_ref" uuid NOT NULL,
	"to_type" text NOT NULL,
	"to_ref" uuid NOT NULL,
	"relationship_type" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"approved_version_id" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"from_foundation_section_id" uuid GENERATED ALWAYS AS (case when from_type='foundation_section' then from_ref end) STORED,
	"from_goal_id" uuid GENERATED ALWAYS AS (case when from_type='goal' then from_ref end) STORED,
	"from_project_id" uuid GENERATED ALWAYS AS (case when from_type='project' then from_ref end) STORED,
	"from_issue_id" uuid GENERATED ALWAYS AS (case when from_type='issue' then from_ref end) STORED,
	"from_milestone_id" uuid GENERATED ALWAYS AS (case when from_type='milestone' then from_ref end) STORED,
	"from_decision_id" uuid GENERATED ALWAYS AS (case when from_type='decision' then from_ref end) STORED,
	"from_metric_id" uuid GENERATED ALWAYS AS (case when from_type='metric' then from_ref end) STORED,
	"from_metric_target_id" uuid GENERATED ALWAYS AS (case when from_type='metric_target' then from_ref end) STORED,
	"from_metric_observation_id" uuid GENERATED ALWAYS AS (case when from_type='metric_observation' then from_ref end) STORED,
	"to_foundation_section_id" uuid GENERATED ALWAYS AS (case when to_type='foundation_section' then to_ref end) STORED,
	"to_goal_id" uuid GENERATED ALWAYS AS (case when to_type='goal' then to_ref end) STORED,
	"to_project_id" uuid GENERATED ALWAYS AS (case when to_type='project' then to_ref end) STORED,
	"to_issue_id" uuid GENERATED ALWAYS AS (case when to_type='issue' then to_ref end) STORED,
	"to_milestone_id" uuid GENERATED ALWAYS AS (case when to_type='milestone' then to_ref end) STORED,
	"to_decision_id" uuid GENERATED ALWAYS AS (case when to_type='decision' then to_ref end) STORED,
	"to_metric_id" uuid GENERATED ALWAYS AS (case when to_type='metric' then to_ref end) STORED,
	"to_metric_target_id" uuid GENERATED ALWAYS AS (case when to_type='metric_target' then to_ref end) STORED,
	"to_metric_observation_id" uuid GENERATED ALWAYS AS (case when to_type='metric_observation' then to_ref end) STORED,
	CONSTRAINT "strategy_links_tenant_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "strategy_links_revision_check" CHECK ("strategy_execution_links"."revision">0),
	CONSTRAINT "strategy_links_status_check" CHECK ("strategy_execution_links"."status" in ('proposed','active','retired') and ("strategy_execution_links"."status"<>'active' or "strategy_execution_links"."approved_version_id" is not null)),
	CONSTRAINT "strategy_links_identity_check" CHECK (("strategy_execution_links"."from_type","strategy_execution_links"."from_ref")<>("strategy_execution_links"."to_type","strategy_execution_links"."to_ref")),
	CONSTRAINT "strategy_links_relationship_check" CHECK ("strategy_execution_links"."relationship_type" in ('supports','measures','constrains','advanced_by','depends_on','conflicts_with','funds','informs')),
	CONSTRAINT "strategy_links_types_check" CHECK ("strategy_execution_links"."from_type" in ('foundation_section','goal','project','issue','milestone','decision','metric','metric_target','metric_observation') and "strategy_execution_links"."to_type" in ('foundation_section','goal','project','issue','milestone','decision','metric','metric_target','metric_observation'))
);
--> statement-breakpoint
ALTER TABLE "analytical_source_suppressions" DROP CONSTRAINT "analytical_source_suppressions_type_check";--> statement-breakpoint
ALTER TABLE "strategy_execution_link_approvals" ADD CONSTRAINT "strategy_approvals_version_fk" FOREIGN KEY ("company_id","link_id","version_id") REFERENCES "public"."strategy_execution_link_versions"("company_id","link_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_execution_link_versions" ADD CONSTRAINT "strategy_execution_link_versions_from_foundation_section_version_id_document_revisions_id_fk" FOREIGN KEY ("from_foundation_section_version_id") REFERENCES "public"."document_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_execution_link_versions" ADD CONSTRAINT "strategy_execution_link_versions_from_metric_version_id_business_metric_versions_id_fk" FOREIGN KEY ("from_metric_version_id") REFERENCES "public"."business_metric_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_execution_link_versions" ADD CONSTRAINT "strategy_execution_link_versions_from_metric_target_version_id_business_metric_target_versions_id_fk" FOREIGN KEY ("from_metric_target_version_id") REFERENCES "public"."business_metric_target_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_execution_link_versions" ADD CONSTRAINT "strategy_execution_link_versions_to_foundation_section_version_id_document_revisions_id_fk" FOREIGN KEY ("to_foundation_section_version_id") REFERENCES "public"."document_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_execution_link_versions" ADD CONSTRAINT "strategy_execution_link_versions_to_metric_version_id_business_metric_versions_id_fk" FOREIGN KEY ("to_metric_version_id") REFERENCES "public"."business_metric_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_execution_link_versions" ADD CONSTRAINT "strategy_execution_link_versions_to_metric_target_version_id_business_metric_target_versions_id_fk" FOREIGN KEY ("to_metric_target_version_id") REFERENCES "public"."business_metric_target_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_execution_link_versions" ADD CONSTRAINT "strategy_versions_link_fk" FOREIGN KEY ("company_id","link_id") REFERENCES "public"."strategy_execution_links"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_execution_links" ADD CONSTRAINT "strategy_execution_links_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_execution_links" ADD CONSTRAINT "strategy_execution_links_from_foundation_section_id_foundation_documents_id_fk" FOREIGN KEY ("from_foundation_section_id") REFERENCES "public"."foundation_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_execution_links" ADD CONSTRAINT "strategy_execution_links_from_goal_id_goals_id_fk" FOREIGN KEY ("from_goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_execution_links" ADD CONSTRAINT "strategy_execution_links_from_project_id_projects_id_fk" FOREIGN KEY ("from_project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_execution_links" ADD CONSTRAINT "strategy_execution_links_from_issue_id_issues_id_fk" FOREIGN KEY ("from_issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_execution_links" ADD CONSTRAINT "strategy_execution_links_from_milestone_id_project_milestones_id_fk" FOREIGN KEY ("from_milestone_id") REFERENCES "public"."project_milestones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_execution_links" ADD CONSTRAINT "strategy_execution_links_from_decision_id_decisions_id_fk" FOREIGN KEY ("from_decision_id") REFERENCES "public"."decisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_execution_links" ADD CONSTRAINT "strategy_execution_links_from_metric_id_business_metrics_id_fk" FOREIGN KEY ("from_metric_id") REFERENCES "public"."business_metrics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_execution_links" ADD CONSTRAINT "strategy_execution_links_from_metric_target_id_business_metric_targets_id_fk" FOREIGN KEY ("from_metric_target_id") REFERENCES "public"."business_metric_targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_execution_links" ADD CONSTRAINT "strategy_execution_links_from_metric_observation_id_business_metric_observations_id_fk" FOREIGN KEY ("from_metric_observation_id") REFERENCES "public"."business_metric_observations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_execution_links" ADD CONSTRAINT "strategy_execution_links_to_foundation_section_id_foundation_documents_id_fk" FOREIGN KEY ("to_foundation_section_id") REFERENCES "public"."foundation_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_execution_links" ADD CONSTRAINT "strategy_execution_links_to_goal_id_goals_id_fk" FOREIGN KEY ("to_goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_execution_links" ADD CONSTRAINT "strategy_execution_links_to_project_id_projects_id_fk" FOREIGN KEY ("to_project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_execution_links" ADD CONSTRAINT "strategy_execution_links_to_issue_id_issues_id_fk" FOREIGN KEY ("to_issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_execution_links" ADD CONSTRAINT "strategy_execution_links_to_milestone_id_project_milestones_id_fk" FOREIGN KEY ("to_milestone_id") REFERENCES "public"."project_milestones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_execution_links" ADD CONSTRAINT "strategy_execution_links_to_decision_id_decisions_id_fk" FOREIGN KEY ("to_decision_id") REFERENCES "public"."decisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_execution_links" ADD CONSTRAINT "strategy_execution_links_to_metric_id_business_metrics_id_fk" FOREIGN KEY ("to_metric_id") REFERENCES "public"."business_metrics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_execution_links" ADD CONSTRAINT "strategy_execution_links_to_metric_target_id_business_metric_targets_id_fk" FOREIGN KEY ("to_metric_target_id") REFERENCES "public"."business_metric_targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_execution_links" ADD CONSTRAINT "strategy_execution_links_to_metric_observation_id_business_metric_observations_id_fk" FOREIGN KEY ("to_metric_observation_id") REFERENCES "public"."business_metric_observations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_execution_links" ADD CONSTRAINT "strategy_links_approved_fk" FOREIGN KEY ("company_id","id","approved_version_id") REFERENCES "public"."strategy_execution_link_versions"("company_id","link_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "strategy_links_from_idx" ON "strategy_execution_links" USING btree ("company_id","from_type","from_ref");--> statement-breakpoint
CREATE INDEX "strategy_links_to_idx" ON "strategy_execution_links" USING btree ("company_id","to_type","to_ref");--> statement-breakpoint
ALTER TABLE "analytical_source_suppressions" ADD CONSTRAINT "analytical_source_suppressions_type_check" CHECK ("analytical_source_suppressions"."input_type" in ('issue','project','goal','document','document_revision'));
--> statement-breakpoint
CREATE FUNCTION aw_strategy_reference_company(kind text, ref uuid) RETURNS uuid LANGUAGE plpgsql STABLE AS $$
DECLARE tenant uuid;
BEGIN
 CASE kind
 WHEN 'foundation_section' THEN SELECT company_id INTO tenant FROM foundation_documents WHERE id=ref;
 WHEN 'goal' THEN SELECT company_id INTO tenant FROM goals WHERE id=ref;
 WHEN 'project' THEN SELECT company_id INTO tenant FROM projects WHERE id=ref;
 WHEN 'issue' THEN SELECT company_id INTO tenant FROM issues WHERE id=ref;
 WHEN 'milestone' THEN SELECT company_id INTO tenant FROM project_milestones WHERE id=ref;
 WHEN 'decision' THEN SELECT company_id INTO tenant FROM decisions WHERE id=ref;
 WHEN 'metric' THEN SELECT company_id INTO tenant FROM business_metrics WHERE id=ref;
 WHEN 'metric_target' THEN SELECT company_id INTO tenant FROM business_metric_targets WHERE id=ref;
 WHEN 'metric_observation' THEN SELECT company_id INTO tenant FROM business_metric_observations WHERE id=ref;
 ELSE tenant:=NULL;
 END CASE;
 RETURN tenant;
END; $$;
--> statement-breakpoint
CREATE FUNCTION aw_strategy_endpoint_erased(tenant uuid, kind text, ref uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM analytical_source_suppressions s WHERE s.company_id=tenant AND (
   (s.input_type=kind AND s.input_ref=ref)
   OR (s.input_type='document' AND kind='foundation_section' AND EXISTS(SELECT 1 FROM foundation_documents f WHERE f.id=ref AND f.company_id=tenant AND f.document_id=s.input_ref))
   OR (s.input_type='project' AND kind='issue' AND EXISTS(SELECT 1 FROM issues i WHERE i.id=ref AND i.company_id=tenant AND i.project_id=s.input_ref))
   OR (s.input_type='project' AND kind='milestone' AND EXISTS(SELECT 1 FROM project_milestones m WHERE m.id=ref AND m.company_id=tenant AND m.project_id=s.input_ref))
   OR (kind='decision' AND s.input_type IN ('issue','project') AND EXISTS(SELECT 1 FROM decisions d JOIN issues i ON i.id=d.origin_issue_id AND i.company_id=d.company_id WHERE d.id=ref AND d.company_id=tenant AND (s.input_ref=i.id AND s.input_type='issue' OR s.input_ref=i.project_id AND s.input_type='project')))
   OR (kind='metric_target' AND EXISTS(SELECT 1 FROM business_metric_targets t WHERE t.id=ref AND t.company_id=tenant AND (s.input_type='goal' AND s.input_ref=t.goal_id OR s.input_type='project' AND s.input_ref=t.project_id)))
   OR (kind='metric_observation' AND EXISTS(SELECT 1 FROM business_metric_observations o JOIN analytical_lineage_edges e ON e.manifest_id=o.lineage_manifest_id AND e.company_id=o.company_id WHERE o.id=ref AND o.company_id=tenant AND e.input_type=s.input_type AND e.input_ref=s.input_ref))
 ));
$$;
--> statement-breakpoint
CREATE FUNCTION aw_strategy_definition_erased(tenant uuid, definition jsonb) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM jsonb_each(jsonb_build_object('from',definition->'from','to',definition->'to')) endpoint JOIN analytical_source_suppressions s ON s.company_id=tenant WHERE
  (s.input_type='document_revision' AND endpoint.value->>'type'='foundation_section' AND endpoint.value->>'approvedRevisionId'=s.input_ref::text)
  OR (s.input_type='project' AND endpoint.value->>'type'='metric' AND EXISTS(SELECT 1 FROM business_metric_versions v WHERE v.company_id=tenant AND v.id=(endpoint.value->>'versionId')::uuid AND coalesce(v.definition_json->'calculation'->'population'->>'projectId',v.definition_json->'calculation'->'denominator'->>'projectId')=s.input_ref::text))
  OR (s.input_type='project' AND endpoint.value->>'type'='metric_target' AND EXISTS(SELECT 1 FROM business_metric_target_versions t JOIN business_metric_versions v ON v.id=t.metric_version_id AND v.company_id=t.company_id WHERE t.company_id=tenant AND t.id=(endpoint.value->>'versionId')::uuid AND coalesce(v.definition_json->'calculation'->'population'->>'projectId',v.definition_json->'calculation'->'denominator'->>'projectId')=s.input_ref::text))
 );
$$;
--> statement-breakpoint
CREATE FUNCTION aw_strategy_source_erased(tenant uuid, link uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM strategy_execution_links l WHERE l.company_id=tenant AND l.id=link AND (
 aw_strategy_endpoint_erased(tenant,l.from_type,l.from_ref) OR aw_strategy_endpoint_erased(tenant,l.to_type,l.to_ref)
 OR EXISTS(SELECT 1 FROM strategy_execution_link_versions v WHERE v.company_id=tenant AND v.link_id=link AND aw_strategy_definition_erased(tenant,v.definition_json))));
$$;
--> statement-breakpoint
CREATE FUNCTION aw_strategy_link_admission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.company_id,NEW.id,NEW.from_type,NEW.from_ref,NEW.to_type,NEW.to_ref,NEW.relationship_type) IS DISTINCT FROM (OLD.company_id,OLD.id,OLD.from_type,OLD.from_ref,OLD.to_type,OLD.to_ref,OLD.relationship_type) THEN
  RAISE EXCEPTION 'Strategy endpoint ownership is immutable' USING ERRCODE='23514';
 END IF;
 IF aw_strategy_reference_company(NEW.from_type,NEW.from_ref) IS DISTINCT FROM NEW.company_id OR aw_strategy_reference_company(NEW.to_type,NEW.to_ref) IS DISTINCT FROM NEW.company_id THEN
  RAISE EXCEPTION 'Strategy endpoints must exist in the same company' USING ERRCODE='23503';
 END IF;
 IF aw_strategy_endpoint_erased(NEW.company_id,NEW.from_type,NEW.from_ref) OR aw_strategy_endpoint_erased(NEW.company_id,NEW.to_type,NEW.to_ref) THEN
  RAISE EXCEPTION 'Strategy source was erased' USING ERRCODE='23514';
 END IF;
 IF NEW.approved_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM strategy_execution_link_approvals a WHERE a.company_id=NEW.company_id AND a.link_id=NEW.id AND a.version_id=NEW.approved_version_id) THEN
  RAISE EXCEPTION 'Strategy approval evidence is unavailable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER aw_strategy_link_admission BEFORE INSERT OR UPDATE ON strategy_execution_links FOR EACH ROW EXECUTE FUNCTION aw_strategy_link_admission();
--> statement-breakpoint
CREATE FUNCTION aw_strategy_version_admission() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE l strategy_execution_links; endpoint jsonb; pin uuid; native_id uuid; tenant uuid; side text;
BEGIN
 SELECT * INTO l FROM strategy_execution_links WHERE company_id=NEW.company_id AND id=NEW.link_id;
 IF l.id IS NULL OR NEW.definition_json->>'relationship' IS DISTINCT FROM l.relationship_type THEN
  RAISE EXCEPTION 'Strategy version identity mismatch' USING ERRCODE='23514';
 END IF;
 FOREACH side IN ARRAY ARRAY['from','to'] LOOP
  endpoint:=NEW.definition_json->side;
  native_id:=CASE WHEN endpoint->>'type'='foundation_section' THEN (endpoint->>'foundationDocumentId')::uuid ELSE (endpoint->>'id')::uuid END;
  IF endpoint->>'type' IS DISTINCT FROM (CASE WHEN side='from' THEN l.from_type ELSE l.to_type END) OR native_id IS DISTINCT FROM (CASE WHEN side='from' THEN l.from_ref ELSE l.to_ref END) THEN
   RAISE EXCEPTION 'Strategy version moves its native endpoint' USING ERRCODE='23514';
  END IF;
  CASE endpoint->>'type'
  WHEN 'foundation_section' THEN
   SELECT r.company_id INTO tenant FROM document_revisions r JOIN foundation_documents f ON f.document_id=r.document_id AND f.company_id=r.company_id WHERE f.id=native_id AND r.id=(endpoint->>'approvedRevisionId')::uuid;
  WHEN 'metric' THEN
   SELECT v.company_id INTO tenant FROM business_metric_versions v WHERE v.metric_id=native_id AND v.id=(endpoint->>'versionId')::uuid;
  WHEN 'metric_target' THEN
   SELECT v.company_id INTO tenant FROM business_metric_target_versions v WHERE v.target_id=native_id AND v.id=(endpoint->>'versionId')::uuid;
  WHEN 'metric_observation' THEN
   SELECT o.company_id INTO tenant FROM business_metric_observations o WHERE o.id=native_id AND o.metric_id=(endpoint->>'metricId')::uuid AND o.version_id=(endpoint->>'metricVersionId')::uuid;
  WHEN 'milestone' THEN
   SELECT m.company_id INTO tenant FROM project_milestones m WHERE m.id=native_id AND m.project_id=(endpoint->>'projectId')::uuid;
  ELSE tenant:=NEW.company_id;
  END CASE;
  IF tenant IS DISTINCT FROM NEW.company_id THEN RAISE EXCEPTION 'Strategy pin is outside its native company owner' USING ERRCODE='23503'; END IF;
 END LOOP;
 IF aw_strategy_definition_erased(NEW.company_id,NEW.definition_json) THEN RAISE EXCEPTION 'Strategy pinned source was erased' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER aw_strategy_version_admission BEFORE INSERT ON strategy_execution_link_versions FOR EACH ROW EXECUTE FUNCTION aw_strategy_version_admission();
--> statement-breakpoint
CREATE TRIGGER aw_strategy_version_immutable BEFORE UPDATE ON strategy_execution_link_versions FOR EACH ROW EXECUTE FUNCTION aw_analytical_snapshot_immutable();
--> statement-breakpoint
CREATE TRIGGER aw_strategy_approval_immutable BEFORE UPDATE ON strategy_execution_link_approvals FOR EACH ROW EXECUTE FUNCTION aw_analytical_snapshot_immutable();
--> statement-breakpoint
CREATE FUNCTION aw_strategy_version_erasure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 DELETE FROM strategy_execution_links WHERE company_id=OLD.company_id AND id=OLD.link_id;
 RETURN OLD;
END; $$;
--> statement-breakpoint
CREATE TRIGGER aw_strategy_version_erasure AFTER DELETE ON strategy_execution_link_versions FOR EACH ROW EXECUTE FUNCTION aw_strategy_version_erasure();
