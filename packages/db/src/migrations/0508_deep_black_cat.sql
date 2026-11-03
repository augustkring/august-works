ALTER TABLE "context_manifest_memory_roots" DROP CONSTRAINT "context_memory_roots_memory_fk";
--> statement-breakpoint
ALTER TABLE "memory_model_evidence" DROP CONSTRAINT "model_evidence_observation_fk";

--> statement-breakpoint
-- Keep source UUID/version receipts after source erasure. The original
-- owning manifest/model-version/company cascades remain in place.
CREATE TRIGGER context_memory_roots_source_reference_present
BEFORE INSERT OR UPDATE OF company_id, memory_record_id ON public.context_manifest_memory_roots
FOR EACH ROW EXECUTE FUNCTION public.aw_memory_source_reference_present();
--> statement-breakpoint
-- As with the Memory source check, this is native insertion integrity only.
-- Original source readers still check current scope, versions and review.
CREATE FUNCTION public.aw_observation_source_reference_present() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.observation_id IS NULL THEN RETURN NEW; END IF;
  PERFORM 1 FROM public.memory_observations r
    WHERE r.company_id = NEW.company_id AND r.id = NEW.observation_id
    FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503',
      MESSAGE = 'Observation source must exist in the same company',
      CONSTRAINT = 'observation_source_reference_present';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER model_evidence_observation_source_reference_present
BEFORE INSERT OR UPDATE OF company_id, observation_id ON public.memory_model_evidence
FOR EACH ROW EXECUTE FUNCTION public.aw_observation_source_reference_present();
