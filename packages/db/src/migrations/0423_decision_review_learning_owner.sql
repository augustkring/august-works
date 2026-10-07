-- Extend the original native review guard; no new transition owner is created.
CREATE OR REPLACE FUNCTION aw_decision_outcome_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
  -- The original state transition owner admits one metadata-only linkage after
  -- human completion. Its deferred guard checks the exact original Source pin.
  IF OLD.learning_cycle_id IS NULL AND NEW.learning_cycle_id IS NOT NULL
   AND OLD.status IN ('completed','inconclusive')
   AND (to_jsonb(OLD)-'learning_cycle_id')=(to_jsonb(NEW)-'learning_cycle_id')
   AND EXISTS(SELECT 1 FROM decision_context_versions WHERE company_id=NEW.company_id AND id=NEW.context_version_id AND expires_at>clock_timestamp()) THEN
   RETURN NEW;
  END IF;
  IF NEW.learning_cycle_id IS DISTINCT FROM OLD.learning_cycle_id THEN
   RAISE EXCEPTION 'Outcome review Learning linkage is immutable and separate from review transitions' USING ERRCODE='23514';
  END IF;
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
CREATE FUNCTION aw_decision_review_learning_source_bound() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_review decision_outcome_reviews%ROWTYPE;
BEGIN
 SELECT * INTO current_review FROM decision_outcome_reviews WHERE company_id=NEW.company_id AND id=NEW.id;
 IF NOT FOUND OR current_review.learning_cycle_id IS NULL THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM learning_cycles c WHERE c.company_id=current_review.company_id AND c.id=current_review.learning_cycle_id
   AND c.scope_type='company' AND c.scope_id IS NULL AND c.analytical_source_count>0
   AND NOT aw_learning_cycle_erased(c.company_id,c.id)
   AND c.analytical_source_pins @> jsonb_build_array(jsonb_build_object('kind','outcome_review','decisionId',current_review.decision_id::text,'revision',current_review.revision))) THEN
  RAISE EXCEPTION 'Learning requires the exact surviving reviewed source' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER decision_review_learning_source_bound AFTER INSERT OR UPDATE ON decision_outcome_reviews
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION aw_decision_review_learning_source_bound();
