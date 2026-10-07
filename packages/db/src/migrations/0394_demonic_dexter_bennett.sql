ALTER TABLE "companies" ADD COLUMN "content_erasure_transaction_id" text;
--> statement-breakpoint
-- The native company tombstone pins erasure to this transaction only. Neither
-- normal archival, a guessed session setting nor a committed old marker grants
-- deletion. This function grants no UPDATE exception to frozen evidence.
CREATE FUNCTION aw_company_content_erasure_current(c uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM companies WHERE id=c AND status='archived'
  AND pause_reason='company_deleted' AND content_erasure_transaction_id=pg_current_xact_id()::text);
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v7_governance_immutable_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' AND aw_company_content_erasure_current(OLD.company_id) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'governance_versioned_evidence_immutable' USING ERRCODE='23514';
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v7_governance_deployment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF aw_company_content_erasure_current(OLD.company_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'governance_deployment_tombstone_required' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' AND (NEW.company_id,NEW.use_case_id,NEW.purpose_version,NEW.issue_id,NEW.agent_id,NEW.purpose_hash,NEW.authority_hash,NEW.created_by_user_id,NEW.created_at) IS DISTINCT FROM (OLD.company_id,OLD.use_case_id,OLD.purpose_version,OLD.issue_id,OLD.agent_id,OLD.purpose_hash,OLD.authority_hash,OLD.created_by_user_id,OLD.created_at) THEN RAISE EXCEPTION 'governance_deployment_scope_immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND OLD.status IN ('review_required','suspended','retired') AND NEW.status='active' THEN RAISE EXCEPTION 'governance_deployment_requires_fresh_binding' USING ERRCODE='23514'; END IF;
 IF NEW.status='active' AND (NOT aw_v7_governance_deployment_current(NEW) OR NOT EXISTS(SELECT 1 FROM instance_settings WHERE singleton_key='default' AND experimental->>'ai_use_cases_v7'='true')) THEN RAISE EXCEPTION 'governance_current_approved_purpose_required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v7_governance_stop_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF aw_company_content_erasure_current(OLD.company_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'governance_stop_tombstone_required' USING ERRCODE='23514';
 END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'queued' OR NEW.attempts<>0 OR NEW.lease_until IS NOT NULL OR NOT EXISTS(
   SELECT 1 FROM ai_use_case_deployments d JOIN heartbeat_runs r ON r.company_id=d.company_id AND (r.native_issue_id=d.issue_id OR (r.native_issue_id IS NULL AND r.context_snapshot->>'issueId'=d.issue_id::text)) AND r.agent_id=d.agent_id
   WHERE d.company_id=NEW.company_id AND d.id=NEW.deployment_id AND r.id=NEW.run_id AND (NOT aw_v7_governance_deployment_current(d) OR r.context_snapshot->>'governanceDeploymentId' IS DISTINCT FROM d.id::text)
  ) THEN RAISE EXCEPTION 'governance_stop_scope_mismatch' USING ERRCODE='23514'; END IF;
 ELSE
  IF (NEW.id,NEW.company_id,NEW.deployment_id,NEW.run_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.company_id,OLD.deployment_id,OLD.run_id,OLD.created_at)
   OR NEW.attempts<OLD.attempts OR NEW.attempts>5 OR (OLD.status='delivered' AND NEW.status<>'delivered')
   OR (NEW.status='delivering' AND (NEW.attempts<>OLD.attempts+1 OR NEW.lease_until IS NULL OR NEW.lease_until>now()+interval '91 seconds' OR (OLD.lease_until IS NOT NULL AND OLD.lease_until>now())))
   OR (NEW.status<>'delivering' AND (NEW.attempts<>OLD.attempts OR NEW.lease_until IS NOT NULL))
   OR (NEW.status='delivered' AND OLD.status<>'delivering')
  THEN RAISE EXCEPTION 'governance_stop_delivery_fenced' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
