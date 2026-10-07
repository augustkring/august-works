CREATE TABLE "decision_causal_pins" (
	"company_id" uuid NOT NULL,
	"decision_id" uuid NOT NULL,
	"context_version_id" uuid NOT NULL,
	"material_key" text NOT NULL,
	"claim_id" uuid NOT NULL,
	"claim_version_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"source_hash" text NOT NULL,
	CONSTRAINT "decision_causal_pins_key_uq" UNIQUE("company_id","context_version_id","material_key"),
	CONSTRAINT "decision_causal_pins_hash_check" CHECK ("decision_causal_pins"."source_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "causal_analysis_runs" ADD CONSTRAINT "causal_analysis_runs_exact_review_uq" UNIQUE("company_id","claim_id","version_id","review_id","id");
--> statement-breakpoint
ALTER TABLE "decision_causal_pins" ADD CONSTRAINT "decision_causal_pins_context_fk" FOREIGN KEY ("company_id","decision_id","context_version_id") REFERENCES "public"."decision_context_versions"("company_id","decision_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_causal_pins" ADD CONSTRAINT "decision_causal_pins_run_fk" FOREIGN KEY ("company_id","claim_id","claim_version_id","review_id","run_id") REFERENCES "public"."causal_analysis_runs"("company_id","claim_id","version_id","review_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_causal_pins" ADD CONSTRAINT "decision_causal_pins_review_fk" FOREIGN KEY ("company_id","claim_id","claim_version_id","review_id") REFERENCES "public"."causal_claim_reviews"("company_id","claim_id","version_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

--> statement-breakpoint
CREATE FUNCTION aw_decision_causal_pin_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v decision_context_versions%ROWTYPE; ref jsonb; captured jsonb;
BEGIN
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM decision_context_versions WHERE company_id=OLD.company_id AND id=OLD.context_version_id)
   AND EXISTS(SELECT 1 FROM causal_analysis_runs WHERE company_id=OLD.company_id AND id=OLD.run_id)
   AND EXISTS(SELECT 1 FROM causal_claim_reviews WHERE company_id=OLD.company_id AND id=OLD.review_id) THEN
   RAISE EXCEPTION 'decision_causal_pin_immutable' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'decision_causal_pin_immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO v FROM decision_context_versions WHERE company_id=NEW.company_id AND decision_id=NEW.decision_id AND id=NEW.context_version_id;
 SELECT value->'source' INTO ref FROM jsonb_array_elements(v.definition_json->'evidence') WHERE value->>'key'=NEW.material_key;
 SELECT value INTO captured FROM jsonb_array_elements(v.captured_evidence_json) WHERE value->>'key'=NEW.material_key;
 IF ref IS NULL OR ref->>'type' IS DISTINCT FROM 'causal_analysis'
  OR captured->'source' IS DISTINCT FROM ref OR captured->>'sourceHash' IS DISTINCT FROM NEW.source_hash
  OR NEW.run_id::text IS DISTINCT FROM ref->>'id' OR NEW.review_id::text IS DISTINCT FROM ref->>'reviewId'
  OR NEW.claim_id::text IS DISTINCT FROM ref->>'claimId' OR NEW.claim_version_id::text IS DISTINCT FROM ref->>'versionId'
  OR NOT EXISTS(SELECT 1 FROM causal_analysis_runs r
   JOIN causal_claim_reviews h ON h.company_id=r.company_id AND h.claim_id=r.claim_id AND h.version_id=r.version_id AND h.id=r.review_id
   JOIN causal_claim_versions p ON p.company_id=r.company_id AND p.claim_id=r.claim_id AND p.id=r.version_id
   JOIN causal_claims c ON c.company_id=p.company_id AND c.id=p.claim_id
   WHERE r.company_id=NEW.company_id AND r.id=NEW.run_id AND h.id=NEW.review_id
    AND h.reviewed_at<=r.started_at AND r.completed_at<=v.created_at AND p.expires_at>=v.expires_at
    AND c.current_version_id=p.id AND c.reviewed_version_id=p.id AND c.latest_run_id=r.id
    AND c.status IN ('supported','refuted','inconclusive') AND c.status=r.result_json->>'status'
    AND captured->'causal'->'definition'=p.definition_json
    AND captured->'causal'->'run'->'result'=r.result_json
    AND captured->'causal'->'run'->>'receiptHash'=r.receipt_hash
    AND captured->'causal'->'review'->>'receiptHash'=h.receipt_hash
    AND r.result_json->>'status'=captured->'facts'->>'status'
    AND captured->'facts'->>'executionAuthority'='advisory_only') THEN
  RAISE EXCEPTION 'decision_exact_causal_evidence_required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_decision_causal_pin_guard BEFORE INSERT OR UPDATE OR DELETE ON decision_causal_pins FOR EACH ROW EXECUTE FUNCTION aw_decision_causal_pin_guard();
--> statement-breakpoint
CREATE TRIGGER aw_decision_erased_causal_pin AFTER DELETE ON decision_causal_pins FOR EACH ROW EXECUTE FUNCTION aw_decision_erased_calculation_pin();
--> statement-breakpoint
CREATE FUNCTION aw_decision_causal_material_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v decision_context_versions%ROWTYPE;
BEGIN
 SELECT * INTO v FROM decision_context_versions WHERE company_id=NEW.company_id AND id=NEW.id;
 IF NOT FOUND THEN RETURN NEW; END IF;
 IF (SELECT count(*) FROM decision_causal_pins WHERE company_id=v.company_id AND context_version_id=v.id)
  <> (SELECT count(*) FROM jsonb_array_elements(v.definition_json->'evidence') e WHERE e->'source'->>'type'='causal_analysis') THEN
  RAISE EXCEPTION 'decision_causal_material_incomplete' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER aw_decision_causal_material_complete AFTER INSERT ON decision_context_versions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION aw_decision_causal_material_complete();

