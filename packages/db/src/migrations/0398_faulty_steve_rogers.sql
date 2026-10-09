CREATE TABLE "decision_outcome_review_receipts" (
	"company_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"payload_json" jsonb NOT NULL,
	"lineage_manifest_id" uuid NOT NULL,
	CONSTRAINT "decision_outcome_review_receipts_revision_uq" UNIQUE("company_id","review_id","revision"),
	CONSTRAINT "decision_outcome_review_receipts_content_check" CHECK ("decision_outcome_review_receipts"."revision">0 and jsonb_typeof("decision_outcome_review_receipts"."payload_json")='object' and "decision_outcome_review_receipts"."payload_json"->>'contentHash' ~ '^[0-9a-f]{64}$' and ("decision_outcome_review_receipts"."payload_json"->>'revision')::integer="decision_outcome_review_receipts"."revision")
);
--> statement-breakpoint
CREATE TABLE "decision_outcome_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"decision_id" uuid NOT NULL,
	"context_version_id" uuid NOT NULL,
	"context_hash" text NOT NULL,
	"option_id" text NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"review_due_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by_user_id" text,
	CONSTRAINT "decision_outcome_reviews_tenant_uq" UNIQUE("company_id","id"),
	CONSTRAINT "decision_outcome_reviews_decision_uq" UNIQUE("company_id","decision_id"),
	CONSTRAINT "decision_outcome_reviews_state_check" CHECK ("decision_outcome_reviews"."revision">0 and "decision_outcome_reviews"."status" in ('scheduled','in_review','completed','inconclusive','cancelled') and ("decision_outcome_reviews"."status" in ('completed','inconclusive'))=("decision_outcome_reviews"."reviewed_at" is not null and "decision_outcome_reviews"."reviewed_by_user_id" is not null) and ("decision_outcome_reviews"."status" in ('completed','inconclusive') or ("decision_outcome_reviews"."reviewed_at" is null and "decision_outcome_reviews"."reviewed_by_user_id" is null))),
	CONSTRAINT "decision_outcome_reviews_content_check" CHECK ("decision_outcome_reviews"."context_hash" ~ '^[0-9a-f]{64}$' and "decision_outcome_reviews"."updated_at">="decision_outcome_reviews"."created_at")
);
--> statement-breakpoint
ALTER TABLE "decision_outcome_review_receipts" ADD CONSTRAINT "decision_outcome_review_receipts_review_fk" FOREIGN KEY ("company_id","review_id") REFERENCES "public"."decision_outcome_reviews"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_outcome_review_receipts" ADD CONSTRAINT "decision_outcome_review_receipts_lineage_fk" FOREIGN KEY ("company_id","lineage_manifest_id") REFERENCES "public"."analytical_lineage_manifests"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_outcome_reviews" ADD CONSTRAINT "decision_outcome_reviews_context_fk" FOREIGN KEY ("company_id","decision_id","context_version_id") REFERENCES "public"."decision_context_versions"("company_id","decision_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decision_outcome_reviews_due_idx" ON "decision_outcome_reviews" USING btree ("company_id","status","review_due_at","id");
--> statement-breakpoint
CREATE FUNCTION aw_decision_outcome_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE due_at timestamptz;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.revision<>1 OR NEW.status<>'scheduled' OR NEW.created_at<>NEW.updated_at OR NOT EXISTS(
   SELECT 1 FROM decision_context_bindings b JOIN decision_context_versions v ON v.company_id=b.company_id AND v.id=b.version_id
    JOIN decisions d ON d.company_id=b.company_id AND d.id=b.decision_id
   WHERE b.company_id=NEW.company_id AND b.decision_id=NEW.decision_id AND b.version_id=NEW.context_version_id
    AND b.context_hash=NEW.context_hash AND b.option_id=NEW.option_id AND v.content_hash=NEW.context_hash
    AND d.status='decided' AND d.chosen_option_id=NEW.option_id AND d.decided_at=b.frozen_at
    AND v.created_at<=b.frozen_at AND b.frozen_at<=NEW.created_at AND v.expires_at>NEW.created_at
  ) THEN RAISE EXCEPTION 'decision_outcome_review_prospective_binding_required' USING ERRCODE='23514'; END IF;
  SELECT max((e->>'reviewAt')::timestamptz) INTO due_at FROM decision_context_versions v,
   jsonb_array_elements(v.definition_json->'expectedOutcomes') e
   WHERE v.company_id=NEW.company_id AND v.id=NEW.context_version_id AND e->>'optionId'=NEW.option_id;
  IF due_at IS NULL OR due_at<>NEW.review_due_at THEN RAISE EXCEPTION 'decision_outcome_review_declared_due_date_required' USING ERRCODE='23514'; END IF;
 ELSE
  IF ROW(NEW.id,NEW.company_id,NEW.decision_id,NEW.context_version_id,NEW.context_hash,NEW.option_id,NEW.review_due_at,NEW.created_by,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.id,OLD.company_id,OLD.decision_id,OLD.context_version_id,OLD.context_hash,OLD.option_id,OLD.review_due_at,OLD.created_by,OLD.created_at)
   OR NEW.revision<>OLD.revision+1 OR NEW.updated_at<OLD.updated_at OR NOT(
    OLD.status='scheduled' AND NEW.status IN ('in_review','cancelled')
    OR OLD.status='in_review' AND NEW.status IN ('completed','inconclusive','cancelled')
   ) THEN RAISE EXCEPTION 'decision_outcome_review_transition_not_admitted' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM decision_context_versions WHERE company_id=NEW.company_id AND id=NEW.context_version_id AND expires_at>NEW.updated_at)
   THEN RAISE EXCEPTION 'decision_outcome_review_baseline_expired' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_decision_outcome_review_guard BEFORE INSERT OR UPDATE ON decision_outcome_reviews FOR EACH ROW EXECUTE FUNCTION aw_decision_outcome_review_guard();
--> statement-breakpoint
CREATE FUNCTION aw_decision_outcome_review_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r decision_outcome_reviews%ROWTYPE; prior_state text; action text;
BEGIN
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM decision_outcome_reviews WHERE company_id=OLD.company_id AND id=OLD.review_id)
   AND EXISTS(SELECT 1 FROM analytical_lineage_manifests WHERE company_id=OLD.company_id AND id=OLD.lineage_manifest_id)
   THEN RAISE EXCEPTION 'decision_outcome_review_receipt_immutable' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'decision_outcome_review_receipt_immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO r FROM decision_outcome_reviews WHERE company_id=NEW.company_id AND id=NEW.review_id;
 action=NEW.payload_json->>'action';
 IF r.id IS NULL OR r.revision<>NEW.revision OR NEW.payload_json->>'toState' IS DISTINCT FROM r.status
  OR NEW.payload_json->>'contextHash' IS DISTINCT FROM r.context_hash
  OR (NEW.payload_json->>'recordedAt')::timestamptz IS DISTINCT FROM r.updated_at
  OR coalesce(length(btrim(NEW.payload_json->>'recordedBy')),0) NOT BETWEEN 1 AND 200
  OR coalesce(length(btrim(NEW.payload_json->>'rationale')),0) NOT BETWEEN 10 AND 2000
  OR NOT EXISTS(SELECT 1 FROM analytical_lineage_manifests m WHERE m.company_id=NEW.company_id AND m.id=NEW.lineage_manifest_id
   AND m.analysis_type='decision_outcome_review' AND m.analysis_ref=NEW.review_id AND m.definition_hash=NEW.payload_json->>'contentHash'
   AND m.created_at=r.updated_at AND m.expires_at=(NEW.payload_json->>'expiresAt')::timestamptz
   AND (m.parameters_json->>'revision')::integer=NEW.revision AND m.parameters_json->>'contextHash'=r.context_hash)
  THEN RAISE EXCEPTION 'decision_outcome_review_exact_receipt_required' USING ERRCODE='23514'; END IF;
 IF NEW.revision=1 THEN
  IF action IS DISTINCT FROM 'schedule' OR NEW.payload_json->>'fromState' IS NOT NULL OR r.status<>'scheduled'
   OR NEW.payload_json->>'recordedBy' IS DISTINCT FROM r.created_by
   THEN RAISE EXCEPTION 'decision_outcome_review_schedule_receipt_required' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT payload_json->>'toState' INTO prior_state FROM decision_outcome_review_receipts WHERE company_id=NEW.company_id AND review_id=NEW.review_id AND revision=NEW.revision-1;
  IF action IS NULL OR prior_state IS NULL OR prior_state IS DISTINCT FROM NEW.payload_json->>'fromState'
   OR NOT(action='begin' AND prior_state='scheduled' AND r.status='in_review'
    OR action='cancel' AND prior_state IN ('scheduled','in_review') AND r.status='cancelled'
    OR action='finish' AND prior_state='in_review' AND r.status IN ('completed','inconclusive'))
   THEN RAISE EXCEPTION 'decision_outcome_review_receipt_predecessor_required' USING ERRCODE='23514'; END IF;
 END IF;
 IF action='finish' THEN
  IF jsonb_typeof(NEW.payload_json->'assessment') IS DISTINCT FROM 'object'
   OR NEW.payload_json->'assessment'->>'result' IS DISTINCT FROM r.status
   OR NEW.payload_json->>'recordedBy' IS DISTINCT FROM r.reviewed_by_user_id
   OR (NEW.payload_json->>'recordedAt')::timestamptz IS DISTINCT FROM r.reviewed_at
   OR coalesce(NEW.payload_json->'assessment'->'assessments'->'causalConfidence'->>'assessment','') NOT IN ('association_only','not_assessed')
   THEN RAISE EXCEPTION 'decision_outcome_review_human_assessment_required' USING ERRCODE='23514'; END IF;
 ELSE
  IF NEW.payload_json->'assessment' IS DISTINCT FROM 'null'::jsonb OR NEW.payload_json->'nativeExecution' IS DISTINCT FROM 'null'::jsonb
   OR NEW.payload_json->'actualEvidence' IS DISTINCT FROM '[]'::jsonb OR NEW.payload_json->'comparisons' IS DISTINCT FROM '[]'::jsonb
   THEN RAISE EXCEPTION 'decision_outcome_review_final_facts_not_admitted' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_decision_outcome_review_receipt_guard BEFORE INSERT OR UPDATE OR DELETE ON decision_outcome_review_receipts FOR EACH ROW EXECUTE FUNCTION aw_decision_outcome_review_receipt_guard();
--> statement-breakpoint
CREATE FUNCTION aw_decision_outcome_review_receipt_required() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r decision_outcome_reviews%ROWTYPE;
BEGIN
 SELECT * INTO r FROM decision_outcome_reviews WHERE company_id=NEW.company_id AND id=NEW.id;
 IF r.id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM decision_outcome_review_receipts WHERE company_id=r.company_id AND review_id=r.id AND revision=r.revision AND payload_json->>'toState'=r.status)
  THEN RAISE EXCEPTION 'decision_outcome_review_human_receipt_required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER aw_decision_outcome_review_receipt_required AFTER INSERT OR UPDATE ON decision_outcome_reviews DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION aw_decision_outcome_review_receipt_required();
--> statement-breakpoint
CREATE FUNCTION aw_decision_outcome_review_erased_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 -- Erasing the current source-owned receipt erases the aggregate and its older
 -- prose. A direct receipt delete is blocked while both native owners survive.
 DELETE FROM decision_outcome_reviews WHERE company_id=OLD.company_id AND id=OLD.review_id AND revision=OLD.revision;
 RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_decision_outcome_review_erased_receipt AFTER DELETE ON decision_outcome_review_receipts FOR EACH ROW EXECUTE FUNCTION aw_decision_outcome_review_erased_receipt();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_decision_context_binding_required() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM decision_context_versions v JOIN decision_contexts c ON c.company_id=v.company_id AND c.decision_id=v.decision_id
   JOIN decisions d ON d.company_id=v.company_id AND d.id=v.decision_id
   JOIN decision_context_preparations p ON p.company_id=c.company_id AND p.decision_id=c.decision_id AND p.revision=c.revision
   WHERE v.company_id=NEW.company_id AND v.decision_id=NEW.decision_id AND v.id=NEW.version_id AND v.content_hash=NEW.context_hash AND v.decision_spec_hash=NEW.decision_spec_hash
   AND v.created_at<=NEW.frozen_at AND v.expires_at>NEW.frozen_at AND c.prepared_version_id=v.id AND p.version_id=v.id AND p.action='prepare' AND p.recorded_at<=NEW.frozen_at
   AND d.status='decided' AND d.chosen_option_id=NEW.option_id AND d.decided_at=NEW.frozen_at AND d.decided_by_user_id=NEW.frozen_by
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(d.options) o WHERE o->>'id'=NEW.option_id))
  THEN RAISE EXCEPTION 'decision_context_atomic_native_choice_required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
