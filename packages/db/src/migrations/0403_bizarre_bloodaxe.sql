CREATE TABLE "business_experiment_metric_pins" (
	"company_id" uuid NOT NULL,
	"experiment_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"metric_key" text NOT NULL,
	"metric_id" uuid NOT NULL,
	"metric_version_id" uuid NOT NULL,
	"content_hash" text NOT NULL,
	CONSTRAINT "business_experiment_metric_pins_key_uq" UNIQUE("company_id","version_id","metric_key"),
	CONSTRAINT "business_experiment_metric_pins_metric_uq" UNIQUE("company_id","version_id","metric_id"),
	CONSTRAINT "business_experiment_metric_pins_hash_check" CHECK ("business_experiment_metric_pins"."content_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "business_experiment_transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"experiment_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"from_state" text NOT NULL,
	"to_state" text NOT NULL,
	"rationale" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "business_experiment_transitions_revision_uq" UNIQUE("company_id","experiment_id","revision"),
	CONSTRAINT "business_experiment_transitions_content_check" CHECK ("business_experiment_transitions"."revision">1 and "business_experiment_transitions"."from_state"<>"business_experiment_transitions"."to_state" and length(btrim("business_experiment_transitions"."rationale")) between 10 and 2000 and length(btrim("business_experiment_transitions"."created_by")) between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "business_experiment_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"experiment_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"definition_json" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"metric_pins_json" jsonb NOT NULL,
	"input_hash" text NOT NULL,
	"decision_id" uuid,
	"lineage_manifest_id" uuid NOT NULL,
	"amendment_reason" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "business_experiment_versions_tenant_uq" UNIQUE("company_id","experiment_id","id"),
	CONSTRAINT "business_experiment_versions_revision_uq" UNIQUE("company_id","experiment_id","revision"),
	CONSTRAINT "business_experiment_versions_content_check" CHECK ("business_experiment_versions"."revision">0 and "business_experiment_versions"."content_hash" ~ '^[0-9a-f]{64}$' and "business_experiment_versions"."input_hash" ~ '^[0-9a-f]{64}$' and jsonb_typeof("business_experiment_versions"."definition_json")='object' and jsonb_typeof("business_experiment_versions"."metric_pins_json")='array' and "business_experiment_versions"."expires_at">"business_experiment_versions"."created_at" and length(btrim("business_experiment_versions"."amendment_reason")) between 10 and 2000)
);
--> statement-breakpoint
CREATE TABLE "business_experiments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"experiment_key" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"current_version_id" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "business_experiments_tenant_uq" UNIQUE("company_id","id"),
	CONSTRAINT "business_experiments_key_uq" UNIQUE("company_id","experiment_key"),
	CONSTRAINT "business_experiments_state_check" CHECK ("business_experiments"."revision">0 and "business_experiments"."state" in ('draft','in_review','ready','running','paused','completed','analyzing','decided','inconclusive','invalid','cancelled') and "business_experiments"."updated_at">="business_experiments"."created_at")
);
--> statement-breakpoint
ALTER TABLE "business_experiment_metric_pins" ADD CONSTRAINT "business_experiment_metric_pins_version_fk" FOREIGN KEY ("company_id","experiment_id","version_id") REFERENCES "public"."business_experiment_versions"("company_id","experiment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_experiment_metric_pins" ADD CONSTRAINT "business_experiment_metric_pins_metric_fk" FOREIGN KEY ("company_id","metric_id","metric_version_id") REFERENCES "public"."business_metric_versions"("company_id","metric_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_experiment_transitions" ADD CONSTRAINT "business_experiment_transitions_version_fk" FOREIGN KEY ("company_id","experiment_id","version_id") REFERENCES "public"."business_experiment_versions"("company_id","experiment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_experiment_versions" ADD CONSTRAINT "business_experiment_versions_root_fk" FOREIGN KEY ("company_id","experiment_id") REFERENCES "public"."business_experiments"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_experiment_versions" ADD CONSTRAINT "business_experiment_versions_lineage_fk" FOREIGN KEY ("company_id","lineage_manifest_id") REFERENCES "public"."analytical_lineage_manifests"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_experiment_versions" ADD CONSTRAINT "business_experiment_versions_decision_fk" FOREIGN KEY ("company_id","decision_id") REFERENCES "public"."decisions"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_experiments" ADD CONSTRAINT "business_experiments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_experiments" ADD CONSTRAINT "business_experiments_version_fk" FOREIGN KEY ("company_id","id","current_version_id") REFERENCES "public"."business_experiment_versions"("company_id","experiment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE FUNCTION aw_experiment_root_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.revision<>1 OR NEW.state<>'draft' OR NEW.current_version_id IS NOT NULL OR NEW.updated_at<>NEW.created_at THEN
   RAISE EXCEPTION 'experiment_initial_draft_required' USING ERRCODE='23514'; END IF;
 ELSE
  IF ROW(NEW.id,NEW.company_id,NEW.experiment_key,NEW.created_by,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.company_id,OLD.experiment_key,OLD.created_by,OLD.created_at) THEN
   RAISE EXCEPTION 'experiment_root_identity_immutable' USING ERRCODE='23514'; END IF;
  IF OLD.current_version_id IS NULL AND OLD.revision=1 AND OLD.state='draft' THEN
   IF NEW.revision<>1 OR NEW.state<>'draft' OR NEW.current_version_id IS NULL OR NEW.updated_at<>OLD.updated_at THEN
    RAISE EXCEPTION 'experiment_initial_version_required' USING ERRCODE='23514'; END IF;
  ELSIF NEW.revision<>OLD.revision+1 OR NEW.updated_at<OLD.updated_at OR OLD.state NOT IN ('draft','in_review','ready') THEN
   RAISE EXCEPTION 'experiment_revision_transition_not_admitted' USING ERRCODE='23514';
  ELSIF NEW.current_version_id IS DISTINCT FROM OLD.current_version_id THEN
   IF NEW.state<>'draft' OR NOT EXISTS(SELECT 1 FROM business_experiment_versions WHERE company_id=NEW.company_id AND experiment_id=NEW.id AND id=NEW.current_version_id AND revision=NEW.revision AND created_at=NEW.updated_at) THEN
    RAISE EXCEPTION 'experiment_explicit_amendment_required' USING ERRCODE='23514'; END IF;
  ELSIF NOT EXISTS(SELECT 1 FROM business_experiment_transitions WHERE company_id=NEW.company_id AND experiment_id=NEW.id AND version_id=NEW.current_version_id AND revision=NEW.revision
   AND from_state=OLD.state AND to_state=NEW.state AND created_at=NEW.updated_at) THEN
   RAISE EXCEPTION 'experiment_exact_transition_receipt_required' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_experiment_root_guard BEFORE INSERT OR UPDATE ON business_experiments FOR EACH ROW EXECUTE FUNCTION aw_experiment_root_guard();
--> statement-breakpoint
CREATE FUNCTION aw_experiment_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r business_experiments%ROWTYPE; pin jsonb; d jsonb; m business_metric_versions%ROWTYPE; expected_role text; expected_key text; metric_count integer;
BEGIN
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM business_experiments WHERE company_id=OLD.company_id AND id=OLD.experiment_id)
   AND EXISTS(SELECT 1 FROM analytical_lineage_manifests WHERE company_id=OLD.company_id AND id=OLD.lineage_manifest_id)
   AND (OLD.decision_id IS NULL OR EXISTS(SELECT 1 FROM decisions WHERE company_id=OLD.company_id AND id=OLD.decision_id))
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(OLD.metric_pins_json) p WHERE NOT EXISTS(SELECT 1 FROM business_metric_versions WHERE company_id=OLD.company_id AND id=(p->>'metricVersionId')::uuid)) THEN
   RAISE EXCEPTION 'experiment_version_immutable' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'experiment_version_immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO r FROM business_experiments WHERE company_id=NEW.company_id AND id=NEW.experiment_id;
 IF r.id IS NULL OR r.state NOT IN ('draft','in_review','ready') OR NEW.revision NOT IN (r.revision,r.revision+1)
  OR (NEW.revision=r.revision AND (r.current_version_id IS NOT NULL OR r.revision<>1 OR NEW.created_at<>r.updated_at)) OR NEW.created_at<r.updated_at
  OR NEW.definition_json->>'purpose' IS DISTINCT FROM 'management_intelligence'
  OR NEW.definition_json->>'design' IS DISTINCT FROM 'individual_randomized_two_arm_binary'
  OR NEW.definition_json->'ethics'->>'personImpact' IS DISTINCT FROM 'none'
  OR NEW.definition_json->'ethics'->'requiresConsent' IS DISTINCT FROM 'false'::jsonb
  OR NEW.definition_json->'ethics'->'changesMaterialAiDecisions' IS DISTINCT FROM 'false'::jsonb
  OR NEW.definition_json->'ethics'->'darkPatterns' IS DISTINCT FROM 'false'::jsonb
  OR NEW.definition_json->'ethics'->'hiddenEmploymentManipulation' IS DISTINCT FROM 'false'::jsonb
  OR NEW.definition_json->'decisionId' IS DISTINCT FROM coalesce(to_jsonb(NEW.decision_id),'null'::jsonb)
  OR NOT EXISTS(SELECT 1 FROM analytical_lineage_manifests WHERE company_id=NEW.company_id AND id=NEW.lineage_manifest_id AND analysis_ref=NEW.id AND analysis_type='experiment_version'
   AND engine_version='aw-native-business-experiment-owner-v1' AND definition_hash=NEW.content_hash AND input_hash=NEW.input_hash AND created_at=NEW.created_at AND expires_at=NEW.expires_at) THEN
  RAISE EXCEPTION 'experiment_exact_native_protocol_required' USING ERRCODE='23514'; END IF;
 metric_count=1+jsonb_array_length(NEW.definition_json->'guardrailMetrics')+jsonb_array_length(NEW.definition_json->'secondaryMetrics')+jsonb_array_length(NEW.definition_json->'diagnostics'->'invariantMetricRefs');
 IF jsonb_array_length(NEW.metric_pins_json)<>metric_count OR metric_count NOT BETWEEN 3 AND 25 THEN
  RAISE EXCEPTION 'experiment_complete_metric_declarations_required' USING ERRCODE='23514'; END IF;
 FOR pin IN SELECT value FROM jsonb_array_elements(NEW.metric_pins_json) LOOP
  SELECT * INTO m FROM business_metric_versions WHERE company_id=NEW.company_id AND metric_id=(pin->>'metricId')::uuid AND id=(pin->>'metricVersionId')::uuid;
  IF m.id IS NULL OR m.content_hash IS DISTINCT FROM pin->>'contentHash'
   OR m.definition_json->>'authorityMode' IS DISTINCT FROM 'aw_native' OR m.definition_json->'calculation'->>'kind' IS DISTINCT FROM 'native_ratio'
   OR m.definition_json->>'grain' IS DISTINCT FROM NEW.definition_json->'population'->>'randomizationUnit'
   OR m.definition_json->>'sensitivity'='confidential' AND NEW.definition_json->>'sensitivity'<>'confidential'
   OR NOT EXISTS(SELECT 1 FROM business_metrics WHERE company_id=NEW.company_id AND id=m.metric_id AND status='published' AND published_version_id=m.id)
   OR NOT EXISTS(SELECT 1 FROM analytical_lineage_edges WHERE company_id=NEW.company_id AND manifest_id=NEW.lineage_manifest_id AND input_type='metric_version' AND input_ref=m.id AND input_hash=m.content_hash AND relationship='definition') THEN
    RAISE EXCEPTION 'experiment_exact_published_metric_required' USING ERRCODE='23514'; END IF;
  IF m.definition_json->'calculation'->'denominator'->>'entity' IS DISTINCT FROM NEW.definition_json->'population'->>'randomizationUnit'
   OR m.definition_json->>'grain'='issue' AND (jsonb_array_length(m.definition_json->'calculation'->'denominator'->'statuses')<>7
    OR NOT m.definition_json->'calculation'->'denominator'->'statuses' @> '["backlog","todo","in_progress","in_review","done","blocked","cancelled"]'::jsonb
    OR m.definition_json->'calculation'->'denominator'->'projectId' IS DISTINCT FROM NEW.definition_json->'scope'->'id')
   OR m.definition_json->>'grain'='project' AND (NEW.definition_json->'scope'->>'type'<>'company' OR jsonb_array_length(m.definition_json->'calculation'->'denominator'->'statuses')<>5
    OR NOT m.definition_json->'calculation'->'denominator'->'statuses' @> '["backlog","planned","in_progress","completed","cancelled"]'::jsonb)
   OR NEW.expires_at>m.created_at+make_interval(days=>(m.definition_json->>'reviewFrequencyDays')::integer) THEN
   RAISE EXCEPTION 'experiment_complete_native_binary_population_required' USING ERRCODE='23514'; END IF;
  d=NULL;
  IF pin->>'role'='primary' THEN d=NEW.definition_json->'primaryMetric';
  ELSIF pin->>'role'='guardrail' THEN SELECT value INTO d FROM jsonb_array_elements(NEW.definition_json->'guardrailMetrics') WHERE value->>'key'=pin->>'key';
  ELSIF pin->>'role'='exploratory' THEN SELECT value INTO d FROM jsonb_array_elements(NEW.definition_json->'secondaryMetrics') WHERE value->>'key'=pin->>'key';
  ELSIF pin->>'role'='invariant' THEN
   SELECT jsonb_build_object('key','invariant_'||ordinality,'metricId',value,'metricVersionId',pin->'metricVersionId') INTO d
    FROM jsonb_array_elements(NEW.definition_json->'diagnostics'->'invariantMetricRefs') WITH ORDINALITY WHERE 'invariant_'||ordinality=pin->>'key';
  END IF;
  IF d IS NULL OR d->>'key' IS DISTINCT FROM pin->>'key' OR d->>'metricId' IS DISTINCT FROM pin->>'metricId' OR d->>'metricVersionId' IS DISTINCT FROM pin->>'metricVersionId' THEN
   RAISE EXCEPTION 'experiment_exact_metric_role_required' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_experiment_version_guard BEFORE INSERT OR UPDATE OR DELETE ON business_experiment_versions FOR EACH ROW EXECUTE FUNCTION aw_experiment_version_guard();
--> statement-breakpoint
CREATE FUNCTION aw_experiment_metric_pin_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM business_experiment_versions WHERE company_id=OLD.company_id AND id=OLD.version_id)
   AND EXISTS(SELECT 1 FROM business_metric_versions WHERE company_id=OLD.company_id AND id=OLD.metric_version_id) THEN
   RAISE EXCEPTION 'experiment_metric_pin_immutable' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' OR NOT EXISTS(SELECT 1 FROM business_experiment_versions v, jsonb_array_elements(v.metric_pins_json) p
  WHERE v.company_id=NEW.company_id AND v.experiment_id=NEW.experiment_id AND v.id=NEW.version_id AND p->>'key'=NEW.metric_key
   AND p->>'metricId'=NEW.metric_id::text AND p->>'metricVersionId'=NEW.metric_version_id::text AND p->>'contentHash'=NEW.content_hash) THEN
  RAISE EXCEPTION 'experiment_exact_metric_pin_required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_experiment_metric_pin_guard BEFORE INSERT OR UPDATE OR DELETE ON business_experiment_metric_pins FOR EACH ROW EXECUTE FUNCTION aw_experiment_metric_pin_guard();
--> statement-breakpoint
CREATE FUNCTION aw_experiment_transition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r business_experiments%ROWTYPE; v business_experiment_versions%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM business_experiment_versions WHERE company_id=OLD.company_id AND id=OLD.version_id) THEN
   RAISE EXCEPTION 'experiment_transition_immutable' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'experiment_transition_immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO r FROM business_experiments WHERE company_id=NEW.company_id AND id=NEW.experiment_id;
 SELECT * INTO v FROM business_experiment_versions WHERE company_id=NEW.company_id AND experiment_id=NEW.experiment_id AND id=NEW.version_id;
 IF r.id IS NULL OR v.id IS NULL OR r.current_version_id<>NEW.version_id OR r.revision+1<>NEW.revision OR r.state<>NEW.from_state OR r.updated_at>NEW.created_at
  OR NOT (NEW.from_state='draft' AND NEW.to_state IN ('in_review','cancelled') OR NEW.from_state='in_review' AND NEW.to_state IN ('draft','ready','cancelled') OR NEW.from_state='ready' AND NEW.to_state IN ('in_review','cancelled'))
  OR NEW.to_state<>'cancelled' AND (NEW.created_at>=(v.definition_json->'sampleOrDurationPlan'->>'from')::timestamptz OR NEW.created_at>=v.expires_at)
  OR NEW.to_state='ready' AND (v.definition_json->'sampleOrDurationPlan'->>'until')::timestamptz>=v.expires_at THEN
  RAISE EXCEPTION 'experiment_human_preregistration_transition_required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_experiment_transition_guard BEFORE INSERT OR UPDATE OR DELETE ON business_experiment_transitions FOR EACH ROW EXECUTE FUNCTION aw_experiment_transition_guard();
--> statement-breakpoint
CREATE FUNCTION aw_experiment_version_pins_required() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v business_experiment_versions%ROWTYPE;
BEGIN
 SELECT * INTO v FROM business_experiment_versions WHERE company_id=NEW.company_id AND id=NEW.id;
 IF v.id IS NOT NULL AND (SELECT count(*) FROM business_experiment_metric_pins WHERE company_id=v.company_id AND version_id=v.id)<>jsonb_array_length(v.metric_pins_json) THEN
  RAISE EXCEPTION 'experiment_complete_source_pins_required' USING ERRCODE='23514'; END IF;
 IF v.id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM business_experiments WHERE company_id=v.company_id AND id=v.experiment_id AND (revision>v.revision OR revision=v.revision AND current_version_id=v.id)) THEN
  RAISE EXCEPTION 'experiment_version_must_advance_owner' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER aw_experiment_version_pins_required AFTER INSERT ON business_experiment_versions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION aw_experiment_version_pins_required();
--> statement-breakpoint
CREATE FUNCTION aw_experiment_root_proof_required() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r business_experiments%ROWTYPE;
BEGIN
 SELECT * INTO r FROM business_experiments WHERE company_id=NEW.company_id AND id=NEW.id;
 IF r.id IS NULL THEN RETURN NEW; END IF;
 IF r.current_version_id IS NULL OR NOT EXISTS(SELECT 1 FROM business_experiment_versions WHERE company_id=r.company_id AND experiment_id=r.id AND id=r.current_version_id)
  OR NOT EXISTS(SELECT 1 FROM business_experiment_versions WHERE company_id=r.company_id AND experiment_id=r.id AND id=r.current_version_id AND revision=r.revision AND created_at=r.updated_at AND r.state='draft')
   AND NOT EXISTS(SELECT 1 FROM business_experiment_transitions WHERE company_id=r.company_id AND experiment_id=r.id AND version_id=r.current_version_id AND revision=r.revision AND to_state=r.state AND created_at=r.updated_at) THEN
  RAISE EXCEPTION 'experiment_protocol_and_lifecycle_proof_required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER aw_experiment_root_proof_required AFTER INSERT OR UPDATE ON business_experiments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION aw_experiment_root_proof_required();
--> statement-breakpoint
CREATE FUNCTION aw_experiment_transition_proof_required() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM business_experiment_transitions WHERE id=NEW.id) AND NOT EXISTS(SELECT 1 FROM business_experiments r WHERE r.company_id=NEW.company_id AND r.id=NEW.experiment_id AND (
  r.revision=NEW.revision AND r.current_version_id=NEW.version_id AND r.state=NEW.to_state AND r.updated_at=NEW.created_at
  OR r.revision>NEW.revision AND (
   EXISTS(SELECT 1 FROM business_experiment_transitions n WHERE n.company_id=NEW.company_id AND n.experiment_id=NEW.experiment_id AND n.version_id=NEW.version_id AND n.revision=NEW.revision+1 AND n.from_state=NEW.to_state AND n.created_at>=NEW.created_at)
   OR EXISTS(SELECT 1 FROM business_experiment_versions v WHERE v.company_id=NEW.company_id AND v.experiment_id=NEW.experiment_id AND v.revision=NEW.revision+1 AND v.created_at>=NEW.created_at)))) THEN
  RAISE EXCEPTION 'experiment_transition_must_advance_owner' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER aw_experiment_transition_proof_required AFTER INSERT ON business_experiment_transitions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION aw_experiment_transition_proof_required();
--> statement-breakpoint
CREATE FUNCTION aw_experiment_erased_metric_pin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 DELETE FROM business_experiment_versions WHERE company_id=OLD.company_id AND id=OLD.version_id;
 RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_experiment_erased_metric_pin AFTER DELETE ON business_experiment_metric_pins FOR EACH ROW EXECUTE FUNCTION aw_experiment_erased_metric_pin();
--> statement-breakpoint
CREATE FUNCTION aw_experiment_erased_last_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 DELETE FROM business_experiments r WHERE r.company_id=OLD.company_id AND r.id=OLD.experiment_id AND NOT EXISTS(SELECT 1 FROM business_experiment_versions WHERE company_id=r.company_id AND experiment_id=r.id);
 RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_experiment_erased_last_version AFTER DELETE ON business_experiment_versions FOR EACH ROW EXECUTE FUNCTION aw_experiment_erased_last_version();
