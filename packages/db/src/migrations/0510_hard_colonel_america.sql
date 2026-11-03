ALTER TABLE "heartbeat_runs" ADD COLUMN "native_input_source_protocol_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ADD CONSTRAINT "heartbeat_runs_native_input_source_protocol_check" CHECK ("heartbeat_runs"."native_input_source_protocol_version" in (0,1));
--> statement-breakpoint
-- Writer capability only: no source completeness, native-mode selection or
-- execution admission follows from this value. Historical writers stay at 0.
CREATE FUNCTION public.aw_native_input_source_protocol_binding() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.native_input_source_protocol_version IS DISTINCT FROM OLD.native_input_source_protocol_version THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Native input source protocol is insert-only';
    END IF;
    IF NEW.native_input_source_protocol_version = 1
      AND OLD.trigger_detail IN ('provider_conformance','agent_safe_test') THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Synthetic probes cannot claim native input source protocol';
    END IF;
  END IF;
  IF NEW.native_input_source_protocol_version = 1
    AND NEW.trigger_detail IN ('provider_conformance','agent_safe_test') THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Synthetic probes cannot claim native input source protocol';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER heartbeat_runs_native_input_source_protocol_binding
BEFORE INSERT OR UPDATE ON public.heartbeat_runs
FOR EACH ROW EXECUTE FUNCTION public.aw_native_input_source_protocol_binding();
