ALTER TABLE "supervision_signals" ADD COLUMN "model_reservation_id" uuid;--> statement-breakpoint
ALTER TABLE "supervision_signals" ADD CONSTRAINT "supervision_signals_company_id_model_reservation_id_orchestration_model_reservations_company_id_id_fk" FOREIGN KEY ("company_id","model_reservation_id") REFERENCES "public"."orchestration_model_reservations"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supervision_signals" ADD CONSTRAINT "supervision_signal_model_reservation_uq" UNIQUE("model_reservation_id");--> statement-breakpoint
ALTER TABLE "supervision_signals" ADD CONSTRAINT "supervision_signal_model_source_check" CHECK (("supervision_signals"."source_type"='read_only_model_trajectory')=("supervision_signals"."model_reservation_id" is not null));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v7_model_trajectory_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r orchestration_model_reservations; p orchestration_plans;
BEGIN
 IF TG_OP='UPDATE' AND (NEW.company_id,NEW.plan_id,NEW.session_id,NEW.model_reservation_id,NEW.source_type,NEW.source_ref)
   IS DISTINCT FROM (OLD.company_id,OLD.plan_id,OLD.session_id,OLD.model_reservation_id,OLD.source_type,OLD.source_ref)
 THEN RAISE EXCEPTION 'semantic_signal_scope_immutable' USING ERRCODE='23514'; END IF;
 IF NEW.model_reservation_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO p FROM orchestration_plans WHERE company_id=NEW.company_id AND id=NEW.plan_id;
 IF TG_OP='UPDATE' THEN
   IF p.erased_at IS NULL AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'model_trajectory_receipt_immutable' USING ERRCODE='23514'; END IF;
   RETURN NEW;
 END IF;
 SELECT * INTO r FROM orchestration_model_reservations WHERE company_id=NEW.company_id AND id=NEW.model_reservation_id;
 IF r.id IS NULL OR r.plan_id<>NEW.plan_id OR r.status<>'completed' OR r.purpose<>'read_only_trajectory'
   OR r.provider_response_hash IS NULL OR r.usage IS NULL OR r.expires_at<=clock_timestamp() OR NEW.source_ref<>r.id::text
   OR p.id IS NULL OR p.erased_at IS NOT NULL OR p.status NOT IN('running','paused','verifying') OR p.risk_class='C4'
   OR NOT coalesce(p.execution_principal->>'type'='user' AND p.execution_principal->>'userId'=r.principal_user_id,false)
   OR p.started_at IS NULL OR p.started_at+((p.budgets->>'maxWallClockSeconds')::int*interval '1 second')<=clock_timestamp()
   OR NOT coalesce(NEW.facts->>'planVersion'=p.version::text AND NEW.facts->>'resultHash'=NEW.snapshot_hash
     AND NEW.facts->>'verdict' IN('on_track','off_track','uncertain','possible_completion')
     AND NEW.facts->>'recommendation' IN('CONTINUE','PAUSE','START_VERIFIER','ESCALATE_HUMAN')
     AND NEW.facts->>'completionCertified'='false' AND NEW.facts->>'runtimeContinuationAuthorized'='false'
     AND NEW.expires_at>clock_timestamp() AND NEW.expires_at<=r.expires_at,false)
 THEN RAISE EXCEPTION 'model_trajectory_requires_native_single_use_dispatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER aw_v7_model_trajectory_guard BEFORE INSERT OR UPDATE ON supervision_signals FOR EACH ROW EXECUTE FUNCTION aw_v7_model_trajectory_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v7_supervision_erasure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.erased_at IS NOT NULL THEN
   UPDATE supervision_interventions SET rationale=NULL WHERE company_id=NEW.company_id AND plan_id=NEW.id;
   UPDATE supervision_signals SET facts='{"erased":true,"completionCertified":false,"runtimeContinuationAuthorized":false}'::jsonb,
     expires_at=clock_timestamp() WHERE company_id=NEW.company_id AND plan_id=NEW.id AND model_reservation_id IS NOT NULL;
 END IF;
 RETURN NEW;
END; $$;
