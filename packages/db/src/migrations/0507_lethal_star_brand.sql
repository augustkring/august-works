ALTER TABLE "memory_model_evidence" DROP CONSTRAINT "model_evidence_memory_fk";
--> statement-breakpoint
ALTER TABLE "memory_observation_evidence" DROP CONSTRAINT "observation_evidence_memory_fk";
--> statement-breakpoint
ALTER TABLE "learning_evidence" DROP CONSTRAINT "learning_evidence_memory_fk";

--> statement-breakpoint
-- Source identity/version receipts deliberately outlive an erased source row.
-- Owning company/cycle/observation/model foreign keys remain authoritative.
-- This replaces only source existence checking, never current read authority.
CREATE FUNCTION public.aw_memory_source_reference_present() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM 1 FROM public.memory_records r
    WHERE r.company_id = NEW.company_id AND r.id = NEW.memory_record_id
    FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503',
      MESSAGE = 'Memory source must exist in the same company',
      CONSTRAINT = 'memory_source_reference_present';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER learning_evidence_source_reference_present
BEFORE INSERT OR UPDATE OF company_id, memory_record_id ON public.learning_evidence
FOR EACH ROW EXECUTE FUNCTION public.aw_memory_source_reference_present();
--> statement-breakpoint
CREATE TRIGGER observation_evidence_source_reference_present
BEFORE INSERT OR UPDATE OF company_id, memory_record_id ON public.memory_observation_evidence
FOR EACH ROW EXECUTE FUNCTION public.aw_memory_source_reference_present();
--> statement-breakpoint
CREATE TRIGGER model_evidence_source_reference_present
BEFORE INSERT OR UPDATE OF company_id, memory_record_id ON public.memory_model_evidence
FOR EACH ROW EXECUTE FUNCTION public.aw_memory_source_reference_present();
