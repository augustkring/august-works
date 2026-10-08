-- Preserve native receipt identities, hashes and verdicts. Only copied Source prose
-- is erased; ordinary receipts remain immutable under their original guard.
CREATE OR REPLACE FUNCTION aw_v7_verification_pin_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE erased boolean;
BEGIN
 SELECT erased_at IS NOT NULL INTO erased FROM orchestration_plans WHERE company_id=NEW.company_id AND id=NEW.plan_id;
 IF erased THEN NEW.review=NULL; NEW.uncertainties='[]'::jsonb; NEW.failed_invariants='[]'::jsonb; NEW.erased_at=coalesce(NEW.erased_at,clock_timestamp()); END IF;
 IF TG_OP='UPDATE' AND ((NEW.company_id,NEW.plan_id,NEW.worker_id,NEW.worker_attempt_id,NEW.issue_id,NEW.completion_contract_id,NEW.completion_contract_hash,NEW.expected_plan_version,NEW.result_hash,NEW.input_artifact_refs,NEW.evidence_refs,NEW.reviewer_type,NEW.reviewer_id,NEW.result,NEW.recommendation,NEW.created_at,NEW.completed_at)
   IS DISTINCT FROM (OLD.company_id,OLD.plan_id,OLD.worker_id,OLD.worker_attempt_id,OLD.issue_id,OLD.completion_contract_id,OLD.completion_contract_hash,OLD.expected_plan_version,OLD.result_hash,OLD.input_artifact_refs,OLD.evidence_refs,OLD.reviewer_type,OLD.reviewer_id,OLD.result,OLD.recommendation,OLD.created_at,OLD.completed_at)
   OR (NOT coalesce(erased,false) AND (NEW.review,NEW.uncertainties,NEW.failed_invariants,NEW.erased_at) IS DISTINCT FROM (OLD.review,OLD.uncertainties,OLD.failed_invariants,OLD.erased_at)))
 THEN RAISE EXCEPTION 'verification_receipt_immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v7_verification_erasure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.erased_at IS NOT NULL THEN
  UPDATE verification_runs SET review=NULL,uncertainties='[]'::jsonb,failed_invariants='[]'::jsonb,
    erased_at=coalesce(erased_at,NEW.erased_at) WHERE company_id=NEW.company_id AND plan_id=NEW.id;
 END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v7_supervision_erasure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.erased_at IS NOT NULL THEN
  UPDATE supervision_interventions SET rationale=NULL WHERE company_id=NEW.company_id AND plan_id=NEW.id;
  UPDATE supervision_signals SET facts='{"erased":true,"completionCertified":false,"runtimeContinuationAuthorized":false}'::jsonb,
    expires_at=clock_timestamp() WHERE company_id=NEW.company_id AND plan_id=NEW.id;
 END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE FUNCTION aw_v8_supervision_source_payload_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM orchestration_plans WHERE company_id=NEW.company_id AND id=NEW.plan_id AND erased_at IS NOT NULL) THEN
  NEW.facts='{"erased":true,"completionCertified":false,"runtimeContinuationAuthorized":false}'::jsonb;
  NEW.expires_at=clock_timestamp();
 END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER aw_v8_supervision_source_payload_guard BEFORE INSERT OR UPDATE ON supervision_signals
 FOR EACH ROW EXECUTE FUNCTION aw_v8_supervision_source_payload_guard();
--> statement-breakpoint
-- Review prose stays in its native Source-owned receipt/intervention. The audit
-- records identities and counts rather than another copy of that prose.
CREATE FUNCTION aw_v8_orchestration_audit_metadata_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.entity_type='orchestration_plan' AND EXISTS(SELECT 1 FROM orchestration_plans p WHERE p.company_id=NEW.company_id AND p.id::text=NEW.entity_id) THEN
  NEW.details=NEW.details-'rationale'-'failedInvariants';
 END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER aw_v8_orchestration_audit_metadata_guard BEFORE INSERT OR UPDATE ON activity_log
 FOR EACH ROW EXECUTE FUNCTION aw_v8_orchestration_audit_metadata_guard();
--> statement-breakpoint
-- Select only actual native plan audit copies through the existing entity index.
-- The guard above makes this metadata repair safe against concurrent audit writes.
UPDATE activity_log a SET details=a.details-'rationale'-'failedInvariants'
 FROM orchestration_plans p WHERE a.company_id=p.company_id AND a.entity_type='orchestration_plan'
 AND a.entity_id=p.id::text AND a.details ?| ARRAY['rationale','failedInvariants'];
--> statement-breakpoint
-- Original native erasure triggers perform the populated backfill under the same
-- company -> Memory lock order used by the live Source owner.
DO $$ DECLARE company uuid;
BEGIN
 FOR company IN SELECT DISTINCT company_id FROM orchestration_plans WHERE erased_at IS NOT NULL ORDER BY company_id LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('business-events:'||company::text,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('memory:privacy:'||company::text,0));
  UPDATE orchestration_plans SET erased_at=erased_at WHERE company_id=company AND erased_at IS NOT NULL;
 END LOOP;
END $$;
