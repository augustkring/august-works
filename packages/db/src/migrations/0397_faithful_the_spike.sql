CREATE TABLE "decision_assumptions" (
	"company_id" uuid NOT NULL,
	"decision_id" uuid NOT NULL,
	"context_version_id" uuid NOT NULL,
	"material_key" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	CONSTRAINT "decision_assumptions_material_uq" UNIQUE("company_id","context_version_id","material_key")
);
--> statement-breakpoint
CREATE TABLE "decision_context_bindings" (
	"company_id" uuid NOT NULL,
	"decision_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"option_id" text NOT NULL,
	"context_hash" text NOT NULL,
	"decision_spec_hash" text NOT NULL,
	"frozen_by" text NOT NULL,
	"frozen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "decision_context_bindings_decision_uq" UNIQUE("company_id","decision_id"),
	CONSTRAINT "decision_context_bindings_hashes_check" CHECK ("decision_context_bindings"."context_hash" ~ '^[0-9a-f]{64}$' and "decision_context_bindings"."decision_spec_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "decision_context_preparations" (
	"company_id" uuid NOT NULL,
	"decision_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"action" text NOT NULL,
	"rationale" text NOT NULL,
	"recorded_by" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decision_context_preparations_revision_uq" UNIQUE("company_id","decision_id","revision"),
	CONSTRAINT "decision_context_preparations_action_check" CHECK ("decision_context_preparations"."revision">0 and "decision_context_preparations"."action" in ('prepare','withdraw') and length("decision_context_preparations"."rationale") between 10 and 2000)
);
--> statement-breakpoint
CREATE TABLE "decision_context_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"decision_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"definition_json" jsonb NOT NULL,
	"captured_evidence_json" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"decision_spec_hash" text NOT NULL,
	"lineage_manifest_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "decision_context_versions_tenant_uq" UNIQUE("company_id","decision_id","id"),
	CONSTRAINT "decision_context_versions_revision_uq" UNIQUE("company_id","decision_id","revision"),
	CONSTRAINT "decision_context_versions_content_check" CHECK ("decision_context_versions"."revision">0 and "decision_context_versions"."content_hash" ~ '^[0-9a-f]{64}$' and "decision_context_versions"."decision_spec_hash" ~ '^[0-9a-f]{64}$' and "decision_context_versions"."expires_at">"decision_context_versions"."created_at" and jsonb_typeof("decision_context_versions"."definition_json")='object' and jsonb_typeof("decision_context_versions"."captured_evidence_json")='array')
);
--> statement-breakpoint
CREATE TABLE "decision_contexts" (
	"company_id" uuid NOT NULL,
	"decision_id" uuid NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"prepared_version_id" uuid,
	CONSTRAINT "decision_contexts_decision_uq" UNIQUE("company_id","decision_id"),
	CONSTRAINT "decision_contexts_revision_check" CHECK ("decision_contexts"."revision">=0)
);
--> statement-breakpoint
CREATE TABLE "decision_criteria" (
	"company_id" uuid NOT NULL,
	"decision_id" uuid NOT NULL,
	"context_version_id" uuid NOT NULL,
	"material_key" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	CONSTRAINT "decision_criteria_material_uq" UNIQUE("company_id","context_version_id","material_key")
);
--> statement-breakpoint
CREATE TABLE "decision_evidence_links" (
	"company_id" uuid NOT NULL,
	"decision_id" uuid NOT NULL,
	"context_version_id" uuid NOT NULL,
	"material_key" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	CONSTRAINT "decision_evidence_links_material_uq" UNIQUE("company_id","context_version_id","material_key")
);
--> statement-breakpoint
CREATE TABLE "decision_expected_outcomes" (
	"company_id" uuid NOT NULL,
	"decision_id" uuid NOT NULL,
	"context_version_id" uuid NOT NULL,
	"material_key" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	CONSTRAINT "decision_expected_outcomes_material_uq" UNIQUE("company_id","context_version_id","material_key")
);
--> statement-breakpoint
ALTER TABLE "decision_assumptions" ADD CONSTRAINT "decision_assumptions_version_fk" FOREIGN KEY ("company_id","decision_id","context_version_id") REFERENCES "public"."decision_context_versions"("company_id","decision_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_context_bindings" ADD CONSTRAINT "decision_context_bindings_version_fk" FOREIGN KEY ("company_id","decision_id","version_id") REFERENCES "public"."decision_context_versions"("company_id","decision_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_context_preparations" ADD CONSTRAINT "decision_context_preparations_version_fk" FOREIGN KEY ("company_id","decision_id","version_id") REFERENCES "public"."decision_context_versions"("company_id","decision_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_context_versions" ADD CONSTRAINT "decision_context_versions_root_fk" FOREIGN KEY ("company_id","decision_id") REFERENCES "public"."decision_contexts"("company_id","decision_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_context_versions" ADD CONSTRAINT "decision_context_versions_lineage_fk" FOREIGN KEY ("company_id","lineage_manifest_id") REFERENCES "public"."analytical_lineage_manifests"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- The generated tenant index must exist before its dependent foreign key.
CREATE UNIQUE INDEX "decisions_tenant_id_uq" ON "decisions" USING btree ("company_id","id");
--> statement-breakpoint
ALTER TABLE "decision_contexts" ADD CONSTRAINT "decision_contexts_decision_fk" FOREIGN KEY ("company_id","decision_id") REFERENCES "public"."decisions"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_criteria" ADD CONSTRAINT "decision_criteria_version_fk" FOREIGN KEY ("company_id","decision_id","context_version_id") REFERENCES "public"."decision_context_versions"("company_id","decision_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_evidence_links" ADD CONSTRAINT "decision_evidence_links_version_fk" FOREIGN KEY ("company_id","decision_id","context_version_id") REFERENCES "public"."decision_context_versions"("company_id","decision_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_expected_outcomes" ADD CONSTRAINT "decision_expected_outcomes_version_fk" FOREIGN KEY ("company_id","decision_id","context_version_id") REFERENCES "public"."decision_context_versions"("company_id","decision_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE TRIGGER aw_decision_context_version_immutable BEFORE UPDATE ON decision_context_versions FOR EACH ROW EXECUTE FUNCTION aw_analytical_snapshot_immutable();
--> statement-breakpoint
CREATE FUNCTION aw_decision_context_material_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE version_body jsonb; material_collection text; expected jsonb;
BEGIN
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM decision_context_versions WHERE company_id=OLD.company_id AND decision_id=OLD.decision_id AND id=OLD.context_version_id)
   THEN RAISE EXCEPTION 'decision_context_material_immutable' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'decision_context_material_immutable' USING ERRCODE='23514'; END IF;
 SELECT definition_json INTO version_body FROM decision_context_versions WHERE company_id=NEW.company_id AND decision_id=NEW.decision_id AND id=NEW.context_version_id;
 material_collection=CASE TG_TABLE_NAME WHEN 'decision_evidence_links' THEN 'evidence' WHEN 'decision_assumptions' THEN 'assumptions' WHEN 'decision_criteria' THEN 'criteria' ELSE 'expectedOutcomes' END;
 IF material_collection='expectedOutcomes' THEN
  IF NEW.material_key !~ '^[0-9]{1,2}$' THEN RAISE EXCEPTION 'decision_context_material_key_invalid' USING ERRCODE='23514'; END IF;
  expected=(version_body->material_collection)->(NEW.material_key::integer);
 ELSE
  SELECT value INTO expected FROM jsonb_array_elements(version_body->material_collection) WHERE value->>'key'=NEW.material_key;
 END IF;
 IF expected IS NULL OR expected IS DISTINCT FROM NEW.payload_json THEN RAISE EXCEPTION 'decision_context_material_version_mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_decision_evidence_guard BEFORE INSERT OR UPDATE OR DELETE ON decision_evidence_links FOR EACH ROW EXECUTE FUNCTION aw_decision_context_material_guard();
--> statement-breakpoint
CREATE TRIGGER aw_decision_assumption_guard BEFORE INSERT OR UPDATE OR DELETE ON decision_assumptions FOR EACH ROW EXECUTE FUNCTION aw_decision_context_material_guard();
--> statement-breakpoint
CREATE TRIGGER aw_decision_criterion_guard BEFORE INSERT OR UPDATE OR DELETE ON decision_criteria FOR EACH ROW EXECUTE FUNCTION aw_decision_context_material_guard();
--> statement-breakpoint
CREATE TRIGGER aw_decision_expectation_guard BEFORE INSERT OR UPDATE OR DELETE ON decision_expected_outcomes FOR EACH ROW EXECUTE FUNCTION aw_decision_context_material_guard();
--> statement-breakpoint
CREATE FUNCTION aw_decision_context_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'decision_context_receipt_immutable' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM decision_context_versions WHERE company_id=OLD.company_id AND decision_id=OLD.decision_id AND id=OLD.version_id)
  THEN RAISE EXCEPTION 'decision_context_receipt_immutable' USING ERRCODE='23514'; END IF;
 RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_decision_preparation_immutable BEFORE UPDATE OR DELETE ON decision_context_preparations FOR EACH ROW EXECUTE FUNCTION aw_decision_context_receipt_guard();
--> statement-breakpoint
CREATE TRIGGER aw_decision_binding_immutable BEFORE UPDATE OR DELETE ON decision_context_bindings FOR EACH ROW EXECUTE FUNCTION aw_decision_context_receipt_guard();
--> statement-breakpoint
CREATE FUNCTION aw_decision_context_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM decisions d JOIN decision_contexts c ON c.company_id=d.company_id AND c.decision_id=d.id
   JOIN analytical_lineage_manifests m ON m.company_id=d.company_id AND m.id=NEW.lineage_manifest_id
   WHERE d.company_id=NEW.company_id AND d.id=NEW.decision_id AND d.status='open' AND d.expires_at>now() AND NEW.revision=c.revision+1
   AND m.analysis_type='decision_context' AND m.analysis_ref=NEW.id AND m.definition_hash=NEW.content_hash AND m.expires_at=NEW.expires_at
   AND m.created_at=NEW.created_at AND m.parameters_json->>'decisionSpecHash'=NEW.decision_spec_hash)
  THEN RAISE EXCEPTION 'decision_context_current_native_owner_required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_decision_context_version_guard BEFORE INSERT ON decision_context_versions FOR EACH ROW EXECUTE FUNCTION aw_decision_context_version_guard();
--> statement-breakpoint
CREATE FUNCTION aw_decision_context_material_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v decision_context_versions%ROWTYPE;
BEGIN
 SELECT * INTO v FROM decision_context_versions WHERE company_id=NEW.company_id AND decision_id=NEW.decision_id AND id=NEW.id;
 IF NOT FOUND THEN RETURN NEW; END IF;
 IF (SELECT count(*) FROM decision_evidence_links WHERE company_id=v.company_id AND context_version_id=v.id)<>jsonb_array_length(v.definition_json->'evidence')
  OR (SELECT count(*) FROM decision_assumptions WHERE company_id=v.company_id AND context_version_id=v.id)<>jsonb_array_length(v.definition_json->'assumptions')
  OR (SELECT count(*) FROM decision_criteria WHERE company_id=v.company_id AND context_version_id=v.id)<>jsonb_array_length(v.definition_json->'criteria')
  OR (SELECT count(*) FROM decision_expected_outcomes WHERE company_id=v.company_id AND context_version_id=v.id)<>jsonb_array_length(v.definition_json->'expectedOutcomes')
  THEN RAISE EXCEPTION 'decision_context_material_incomplete' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER aw_decision_context_material_complete AFTER INSERT ON decision_context_versions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION aw_decision_context_material_complete();
--> statement-breakpoint
CREATE FUNCTION aw_decision_context_root_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.revision<>0 OR NEW.prepared_version_id IS NOT NULL THEN RAISE EXCEPTION 'decision_context_empty_root_required' USING ERRCODE='23514'; END IF;
 ELSE
  IF (NEW.company_id,NEW.decision_id) IS DISTINCT FROM (OLD.company_id,OLD.decision_id) OR NEW.revision<>OLD.revision+1
   THEN RAISE EXCEPTION 'decision_context_revision_required' USING ERRCODE='23514'; END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM decisions WHERE company_id=NEW.company_id AND id=NEW.decision_id AND status='open' AND expires_at>now())
  THEN RAISE EXCEPTION 'decision_context_open_decision_required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_decision_context_root_guard BEFORE INSERT OR UPDATE ON decision_contexts FOR EACH ROW EXECUTE FUNCTION aw_decision_context_root_guard();
--> statement-breakpoint
CREATE FUNCTION aw_decision_context_prepared_receipt_required() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c decision_contexts%ROWTYPE;
BEGIN
 SELECT * INTO c FROM decision_contexts WHERE company_id=NEW.company_id AND decision_id=NEW.decision_id;
 IF NOT FOUND OR c.revision=0 THEN RETURN NEW; END IF;
 IF c.prepared_version_id IS NULL THEN
  IF EXISTS(SELECT 1 FROM decision_context_versions WHERE company_id=c.company_id AND decision_id=c.decision_id AND revision=c.revision)
   OR EXISTS(SELECT 1 FROM decision_context_preparations WHERE company_id=c.company_id AND decision_id=c.decision_id AND revision=c.revision AND action='withdraw')
   THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.prepared_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM decision_context_versions WHERE company_id=c.company_id AND decision_id=c.decision_id AND id=OLD.prepared_version_id)
   THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'decision_context_proposal_or_withdrawal_required' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM decision_context_preparations p JOIN decision_context_versions v ON v.company_id=p.company_id AND v.decision_id=p.decision_id AND v.id=p.version_id
   WHERE p.company_id=c.company_id AND p.decision_id=c.decision_id AND p.version_id=c.prepared_version_id AND p.revision=c.revision AND p.action='prepare' AND v.expires_at>now())
  THEN RAISE EXCEPTION 'decision_context_human_preparation_required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER aw_decision_context_prepared_receipt_required AFTER INSERT OR UPDATE ON decision_contexts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION aw_decision_context_prepared_receipt_required();
--> statement-breakpoint
CREATE FUNCTION aw_decision_context_binding_required() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM decision_context_versions v JOIN decision_contexts c ON c.company_id=v.company_id AND c.decision_id=v.decision_id
   JOIN decisions d ON d.company_id=v.company_id AND d.id=v.decision_id
   JOIN decision_context_preparations p ON p.company_id=c.company_id AND p.decision_id=c.decision_id AND p.revision=c.revision
   WHERE v.company_id=NEW.company_id AND v.decision_id=NEW.decision_id AND v.id=NEW.version_id AND v.content_hash=NEW.context_hash AND v.decision_spec_hash=NEW.decision_spec_hash
   AND v.expires_at>NEW.frozen_at AND c.prepared_version_id=v.id AND p.version_id=v.id AND p.action='prepare'
   AND d.status='decided' AND d.chosen_option_id=NEW.option_id AND d.decided_at=NEW.frozen_at AND d.decided_by_user_id=NEW.frozen_by)
  THEN RAISE EXCEPTION 'decision_context_atomic_native_choice_required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER aw_decision_context_binding_required AFTER INSERT ON decision_context_bindings DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION aw_decision_context_binding_required();
--> statement-breakpoint
CREATE FUNCTION aw_decision_bound_spec_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status='decided' AND EXISTS(SELECT 1 FROM decision_context_bindings WHERE company_id=OLD.company_id AND decision_id=OLD.id)
  AND (NEW.company_id,NEW.id,NEW.status,NEW.options,NEW.inputs,NEW.signed_spec,NEW.target_snapshots,NEW.chosen_option_id,NEW.input_values,NEW.decided_by_user_id,NEW.decided_at)
   IS DISTINCT FROM (OLD.company_id,OLD.id,OLD.status,OLD.options,OLD.inputs,OLD.signed_spec,OLD.target_snapshots,OLD.chosen_option_id,OLD.input_values,OLD.decided_by_user_id,OLD.decided_at)
  THEN RAISE EXCEPTION 'decision_bound_native_spec_immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_decision_bound_spec_guard BEFORE UPDATE ON decisions FOR EACH ROW EXECUTE FUNCTION aw_decision_bound_spec_guard();
