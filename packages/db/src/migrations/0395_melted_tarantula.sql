CREATE TABLE "process_finding_transitions" (
	"company_id" uuid NOT NULL,
	"finding_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"reason" text NOT NULL,
	"recorded_by" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "process_finding_transitions_revision_uq" UNIQUE("company_id","finding_id","version"),
	CONSTRAINT "process_finding_transition_reason_check" CHECK ("process_finding_transitions"."version">0 and length(btrim("process_finding_transitions"."reason")) between 10 and 2000 and "process_finding_transitions"."to_status" in ('OPEN','ACKNOWLEDGED','INVESTIGATING','RESOLVED','SUPPRESSED_WITH_REASON'))
);
--> statement-breakpoint
CREATE TABLE "process_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"analysis_run_id" uuid NOT NULL,
	"definition_id" uuid NOT NULL,
	"finding_type" text NOT NULL,
	"object_type" text,
	"variant_hash" text,
	"severity" text NOT NULL,
	"interpretation" text NOT NULL,
	"summary" text NOT NULL,
	"facts_json" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"definition_hash" text NOT NULL,
	"event_set_hash" text NOT NULL,
	"fingerprint" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "process_findings_tenant_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "process_findings_material_uq" UNIQUE("company_id","analysis_run_id","fingerprint"),
	CONSTRAINT "process_findings_state_check" CHECK ("process_findings"."version">0 and "process_findings"."status" in ('OPEN','ACKNOWLEDGED','INVESTIGATING','RESOLVED','SUPPRESSED_WITH_REASON') and ("process_findings"."status"='RESOLVED')=("process_findings"."resolved_at" is not null)),
	CONSTRAINT "process_findings_scope_check" CHECK ("process_findings"."finding_type" in ('missing_process_data','rework','avoidable_wait','bottleneck','unusual_variant') and ("process_findings"."finding_type"='missing_process_data')=("process_findings"."object_type" is null) and ("process_findings"."object_type" is null or "process_findings"."object_type" in ('issue','project'))),
	CONSTRAINT "process_findings_variant_check" CHECK (("process_findings"."finding_type"='unusual_variant')=("process_findings"."variant_hash" is not null) and ("process_findings"."variant_hash" is null or "process_findings"."variant_hash" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "process_findings_evidence_check" CHECK ("process_findings"."content_hash" ~ '^[0-9a-f]{64}$' and "process_findings"."definition_hash" ~ '^[0-9a-f]{64}$' and "process_findings"."event_set_hash" ~ '^[0-9a-f]{64}$' and "process_findings"."fingerprint" ~ '^[0-9a-f]{64}$' and "process_findings"."expires_at">"process_findings"."created_at" and "process_findings"."severity" in ('low','medium','high') and jsonb_typeof("process_findings"."facts_json")='object')
);
--> statement-breakpoint
ALTER TABLE "process_finding_transitions" ADD CONSTRAINT "process_finding_transitions_finding_fk" FOREIGN KEY ("company_id","finding_id") REFERENCES "public"."process_findings"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_findings" ADD CONSTRAINT "process_findings_run_fk" FOREIGN KEY ("company_id","analysis_run_id") REFERENCES "public"."process_analysis_runs"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "process_findings_run_idx" ON "process_findings" USING btree ("company_id","analysis_run_id","id");
--> statement-breakpoint
CREATE FUNCTION aw_process_finding_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'OPEN' OR NEW.version<>1 OR NEW.resolved_at IS NOT NULL OR NOT EXISTS(
   SELECT 1 FROM process_analysis_runs r WHERE r.company_id=NEW.company_id AND r.id=NEW.analysis_run_id
    AND r.definition_id=NEW.definition_id AND r.definition_hash=NEW.definition_hash AND r.event_set_hash=NEW.event_set_hash
    AND r.expires_at>now() AND NEW.expires_at<=r.expires_at
    AND ((NEW.finding_type='missing_process_data' AND r.result_json->>'errorCode'='DATA_NOT_READY')
      OR (NEW.finding_type<>'missing_process_data' AND r.result_json->>'status'='succeeded'))
  ) THEN RAISE EXCEPTION 'process_finding_current_run_required' USING ERRCODE='23514'; END IF;
 ELSE
  IF (NEW.id,NEW.company_id,NEW.analysis_run_id,NEW.definition_id,NEW.finding_type,NEW.object_type,NEW.variant_hash,NEW.severity,
      NEW.interpretation,NEW.summary,NEW.facts_json,NEW.content_hash,NEW.definition_hash,NEW.event_set_hash,NEW.fingerprint,NEW.created_by,NEW.created_at,NEW.expires_at)
    IS DISTINCT FROM
     (OLD.id,OLD.company_id,OLD.analysis_run_id,OLD.definition_id,OLD.finding_type,OLD.object_type,OLD.variant_hash,OLD.severity,
      OLD.interpretation,OLD.summary,OLD.facts_json,OLD.content_hash,OLD.definition_hash,OLD.event_set_hash,OLD.fingerprint,OLD.created_by,OLD.created_at,OLD.expires_at)
   THEN RAISE EXCEPTION 'process_finding_evidence_immutable' USING ERRCODE='23514'; END IF;
  IF NEW.version<>OLD.version+1 OR NOT(
    (OLD.status='OPEN' AND NEW.status IN ('ACKNOWLEDGED','SUPPRESSED_WITH_REASON'))
    OR (OLD.status='ACKNOWLEDGED' AND NEW.status IN ('INVESTIGATING','SUPPRESSED_WITH_REASON'))
    OR (OLD.status='INVESTIGATING' AND NEW.status IN ('RESOLVED','SUPPRESSED_WITH_REASON'))
   ) THEN RAISE EXCEPTION 'process_finding_transition_not_admitted' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_process_finding_guard BEFORE INSERT OR UPDATE ON process_findings FOR EACH ROW EXECUTE FUNCTION aw_process_finding_guard();
--> statement-breakpoint
CREATE FUNCTION aw_process_finding_transition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prior_state text;
BEGIN
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM process_findings WHERE company_id=OLD.company_id AND id=OLD.finding_id)
   THEN RAISE EXCEPTION 'process_finding_transition_immutable' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'process_finding_transition_immutable' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM process_findings f WHERE f.company_id=NEW.company_id AND f.id=NEW.finding_id AND f.version=NEW.version AND f.status=NEW.to_status)
  THEN RAISE EXCEPTION 'process_finding_transition_scope_required' USING ERRCODE='23514'; END IF;
 IF NEW.version=1 THEN
  IF NEW.from_status IS NOT NULL OR NEW.to_status<>'OPEN' OR NOT EXISTS(
   SELECT 1 FROM process_findings f WHERE f.company_id=NEW.company_id AND f.id=NEW.finding_id AND f.interpretation=NEW.reason
  ) THEN RAISE EXCEPTION 'process_finding_initial_interpretation_required' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT to_status INTO prior_state FROM process_finding_transitions WHERE company_id=NEW.company_id AND finding_id=NEW.finding_id AND version=NEW.version-1;
  IF prior_state IS NULL OR NEW.from_status IS DISTINCT FROM prior_state
   THEN RAISE EXCEPTION 'process_finding_transition_predecessor_required' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_process_finding_transition_guard BEFORE INSERT OR UPDATE OR DELETE ON process_finding_transitions FOR EACH ROW EXECUTE FUNCTION aw_process_finding_transition_guard();
--> statement-breakpoint
CREATE FUNCTION aw_process_finding_receipt_required() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_version integer; current_status text;
BEGIN
 SELECT version,status INTO current_version,current_status FROM process_findings WHERE company_id=NEW.company_id AND id=NEW.id;
 IF current_version IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM process_finding_transitions WHERE company_id=NEW.company_id AND finding_id=NEW.id AND version=current_version AND to_status=current_status
 ) THEN RAISE EXCEPTION 'process_finding_human_receipt_required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER aw_process_finding_receipt_required AFTER INSERT OR UPDATE ON process_findings DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION aw_process_finding_receipt_required();
