CREATE TABLE "verification_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"worker_id" uuid,
	"worker_attempt_id" uuid,
	"issue_id" uuid NOT NULL,
	"completion_contract_id" uuid NOT NULL,
	"completion_contract_hash" text NOT NULL,
	"expected_plan_version" integer NOT NULL,
	"result_hash" text NOT NULL,
	"input_artifact_refs" jsonb NOT NULL,
	"evidence_refs" jsonb NOT NULL,
	"reviewer_type" text NOT NULL,
	"reviewer_id" text NOT NULL,
	"result" text NOT NULL,
	"failed_invariants" jsonb NOT NULL,
	"uncertainties" jsonb NOT NULL,
	"review" jsonb,
	"recommendation" text NOT NULL,
	"erased_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verification_run_tenant_uq" UNIQUE("company_id","id"),
	CONSTRAINT "verification_result_check" CHECK ("verification_runs"."result" in ('pass','fail','inconclusive','needs_human')),
	CONSTRAINT "verification_reviewer_check" CHECK ("verification_runs"."reviewer_type"='human'),
	CONSTRAINT "verification_plan_version_check" CHECK ("verification_runs"."expected_plan_version">0)
);
--> statement-breakpoint
ALTER TABLE "verification_runs" ADD CONSTRAINT "verification_runs_company_id_plan_id_orchestration_plans_company_id_id_fk" FOREIGN KEY ("company_id","plan_id") REFERENCES "public"."orchestration_plans"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_runs" ADD CONSTRAINT "verification_runs_company_id_plan_id_worker_id_orchestration_workers_company_id_plan_id_id_fk" FOREIGN KEY ("company_id","plan_id","worker_id") REFERENCES "public"."orchestration_workers"("company_id","plan_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_runs" ADD CONSTRAINT "verification_runs_company_id_plan_id_worker_attempt_id_orchestration_worker_attempts_company_id_plan_id_id_fk" FOREIGN KEY ("company_id","plan_id","worker_attempt_id") REFERENCES "public"."orchestration_worker_attempts"("company_id","plan_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_runs" ADD CONSTRAINT "verification_runs_company_id_issue_id_issues_company_id_id_fk" FOREIGN KEY ("company_id","issue_id") REFERENCES "public"."issues"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_runs" ADD CONSTRAINT "verification_runs_company_id_issue_id_completion_contract_id_completion_contracts_company_id_issue_id_id_fk" FOREIGN KEY ("company_id","issue_id","completion_contract_id") REFERENCES "public"."completion_contracts"("company_id","issue_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "verification_plan_idx" ON "verification_runs" USING btree ("company_id","plan_id","created_at");--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v7_verified_completion_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='completed' AND OLD.status<>'completed' THEN
  IF TG_TABLE_NAME='orchestration_workers' THEN
   IF NOT EXISTS(SELECT 1 FROM verification_runs v JOIN orchestration_plans p ON p.company_id=v.company_id AND p.id=v.plan_id JOIN completion_contracts c ON c.company_id=v.company_id AND c.id=v.completion_contract_id
     WHERE v.company_id=NEW.company_id AND v.plan_id=NEW.plan_id AND v.issue_id=NEW.issue_id AND v.completion_contract_id=NEW.completion_contract_id AND (v.worker_id=NEW.id OR v.worker_id IS NULL) AND v.result='pass' AND v.erased_at IS NULL AND v.completion_contract_hash=c.canonical_sha256 AND v.expected_plan_version=p.version)
   THEN RAISE EXCEPTION 'worker_completion_requires_current_independent_receipt' USING ERRCODE='23514'; END IF;
  ELSE
   IF NOT EXISTS(SELECT 1 FROM verification_runs v JOIN completion_contracts c ON c.company_id=v.company_id AND c.id=v.completion_contract_id
     WHERE v.company_id=NEW.company_id AND v.plan_id=NEW.id AND v.issue_id=NEW.issue_id AND v.completion_contract_id=NEW.completion_contract_id AND v.result='pass' AND v.erased_at IS NULL AND v.completion_contract_hash=c.canonical_sha256 AND v.expected_plan_version=OLD.version)
   THEN RAISE EXCEPTION 'plan_completion_requires_current_independent_receipt' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER aw_v7_verified_worker_complete BEFORE UPDATE OF status ON orchestration_workers FOR EACH ROW EXECUTE FUNCTION aw_v7_verified_completion_guard();
--> statement-breakpoint
CREATE TRIGGER aw_v7_verified_plan_complete BEFORE UPDATE OF status ON orchestration_plans FOR EACH ROW EXECUTE FUNCTION aw_v7_verified_completion_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v7_verified_output_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE doc uuid; company uuid;
BEGIN
 IF TG_TABLE_NAME='documents' THEN
  IF TG_OP='UPDATE' AND (NEW.latest_body,NEW.latest_revision_id) IS NOT DISTINCT FROM (OLD.latest_body,OLD.latest_revision_id) THEN RETURN NEW; END IF;
  doc=OLD.id; company=OLD.company_id;
 ELSE
  doc=OLD.document_id; company=OLD.company_id;
 END IF;
 IF EXISTS(SELECT 1 FROM verification_runs v JOIN orchestration_plans p ON p.company_id=v.company_id AND p.id=v.plan_id WHERE v.company_id=company AND v.result='pass' AND v.erased_at IS NULL AND p.erased_at IS NULL AND p.status NOT IN('completed','cancelled','failed')
   AND v.input_artifact_refs @> jsonb_build_array(jsonb_build_object('type','task_document','sourceId',doc::text)))
 THEN RAISE EXCEPTION 'verified_output_requires_new_plan' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER aw_v7_verified_output_guard BEFORE UPDATE OF latest_body,latest_revision_id OR DELETE ON documents FOR EACH ROW EXECUTE FUNCTION aw_v7_verified_output_guard();
--> statement-breakpoint
CREATE TRIGGER aw_v7_verified_output_link_guard BEFORE UPDATE OR DELETE ON issue_documents FOR EACH ROW EXECUTE FUNCTION aw_v7_verified_output_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v7_verification_erasure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.erased_at IS NOT NULL THEN UPDATE verification_runs SET review=NULL,uncertainties='[]'::jsonb,erased_at=coalesce(erased_at,NEW.erased_at) WHERE company_id=NEW.company_id AND plan_id=NEW.id; END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER aw_v7_verification_erasure AFTER UPDATE OF erased_at ON orchestration_plans FOR EACH ROW EXECUTE FUNCTION aw_v7_verification_erasure();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v7_verification_pin_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE erased boolean;
BEGIN
 SELECT erased_at IS NOT NULL INTO erased FROM orchestration_plans WHERE company_id=NEW.company_id AND id=NEW.plan_id;
 IF erased THEN NEW.review=NULL; NEW.uncertainties='[]'::jsonb; NEW.erased_at=coalesce(NEW.erased_at,clock_timestamp()); END IF;
 IF TG_OP='UPDATE' AND ((NEW.company_id,NEW.plan_id,NEW.worker_id,NEW.worker_attempt_id,NEW.issue_id,NEW.completion_contract_id,NEW.completion_contract_hash,NEW.expected_plan_version,NEW.result_hash,NEW.input_artifact_refs,NEW.evidence_refs,NEW.reviewer_type,NEW.reviewer_id,NEW.result,NEW.failed_invariants,NEW.recommendation,NEW.created_at,NEW.completed_at)
   IS DISTINCT FROM (OLD.company_id,OLD.plan_id,OLD.worker_id,OLD.worker_attempt_id,OLD.issue_id,OLD.completion_contract_id,OLD.completion_contract_hash,OLD.expected_plan_version,OLD.result_hash,OLD.input_artifact_refs,OLD.evidence_refs,OLD.reviewer_type,OLD.reviewer_id,OLD.result,OLD.failed_invariants,OLD.recommendation,OLD.created_at,OLD.completed_at)
   OR (NOT coalesce(erased,false) AND (NEW.review,NEW.uncertainties,NEW.erased_at) IS DISTINCT FROM (OLD.review,OLD.uncertainties,OLD.erased_at)))
 THEN RAISE EXCEPTION 'verification_receipt_immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER aw_v7_verification_pin_guard BEFORE INSERT OR UPDATE ON verification_runs FOR EACH ROW EXECUTE FUNCTION aw_v7_verification_pin_guard();
--> statement-breakpoint
CREATE TRIGGER aw_v7_verified_revision_guard BEFORE UPDATE OF body OR DELETE ON document_revisions FOR EACH ROW EXECUTE FUNCTION aw_v7_verified_output_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v7_verified_tool_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.company_id,NEW.run_id,NEW.workflow_run_id,NEW.tool_name,NEW.arguments_hash,NEW.status,NEW.approval_state,NEW.result_hash) IS NOT DISTINCT FROM (OLD.company_id,OLD.run_id,OLD.workflow_run_id,OLD.tool_name,OLD.arguments_hash,OLD.status,OLD.approval_state,OLD.result_hash) THEN RETURN NEW; END IF;
 IF EXISTS(SELECT 1 FROM verification_runs v JOIN orchestration_plans p ON p.company_id=v.company_id AND p.id=v.plan_id WHERE v.company_id=OLD.company_id AND v.result='pass' AND v.erased_at IS NULL AND p.erased_at IS NULL AND p.status NOT IN('completed','cancelled','failed')
   AND v.input_artifact_refs @> jsonb_build_array(jsonb_build_object('type','tool_receipt','sourceId',OLD.id::text)))
 THEN RAISE EXCEPTION 'verified_tool_receipt_immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER aw_v7_verified_tool_receipt_guard BEFORE UPDATE OR DELETE ON tool_invocations FOR EACH ROW EXECUTE FUNCTION aw_v7_verified_tool_receipt_guard();
