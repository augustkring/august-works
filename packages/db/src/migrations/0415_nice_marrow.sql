ALTER TABLE "analytical_context_roots" ADD CONSTRAINT "analytical_context_roots_pins_validity" CHECK (jsonb_typeof("analytical_context_roots"."authority_pins")='array' and jsonb_array_length("analytical_context_roots"."authority_pins") between 0 and 32);
--> statement-breakpoint
-- Metadata/definition inputs use the existing content-free C7 ledger. Never
-- remove a parent manifest while holding its native source owner's row lock.
CREATE FUNCTION aw_analytical_input_context_erased() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE input_kind text; source_manifest uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM companies WHERE id=OLD.company_id) THEN RETURN OLD; END IF;
 input_kind=case when TG_TABLE_NAME='business_metric_versions' then 'metric_version' else 'governance_obligation' end;
 INSERT INTO memory_deletion_markers(company_id,key,kind,deleted_at)
 VALUES(OLD.company_id,encode(sha256(convert_to(format('["%s","source",["august_works_analytical_input","%s://%s"]]',OLD.company_id,input_kind,OLD.id),'UTF8')),'hex'),'source',clock_timestamp()) ON CONFLICT DO NOTHING;
 FOR source_manifest IN SELECT DISTINCT manifest_id FROM analytical_lineage_edges WHERE company_id=OLD.company_id AND input_type=input_kind AND input_ref=OLD.id LOOP
  PERFORM aw_analytical_manifest_source_deleted(OLD.company_id,source_manifest);
 END LOOP;
 RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER metric_version_context_erased AFTER DELETE ON business_metric_versions FOR EACH ROW EXECUTE FUNCTION aw_analytical_input_context_erased();
--> statement-breakpoint
CREATE TRIGGER governance_obligation_context_erased AFTER DELETE ON governance_obligations FOR EACH ROW EXECUTE FUNCTION aw_analytical_input_context_erased();
--> statement-breakpoint
CREATE FUNCTION aw_analytical_restored_lineage_denied() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE marker text;
BEGIN
 IF TG_TABLE_NAME='analytical_lineage_manifests' THEN
  marker=encode(sha256(convert_to(format('["%s","source",["august_works_analytical","manifest://%s"]]',NEW.company_id,NEW.id),'UTF8')),'hex');
 ELSE
  marker=encode(sha256(convert_to(format('["%s","source",["august_works_analytical_input","%s://%s"]]',NEW.company_id,NEW.input_type,NEW.input_ref),'UTF8')),'hex');
 END IF;
 IF EXISTS(SELECT 1 FROM memory_deletion_markers WHERE company_id=NEW.company_id AND key=marker AND kind='source') THEN
  RAISE EXCEPTION 'Original analytical source was erased' USING ERRCODE='23514',CONSTRAINT='aw_analytical_source_erased';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER analytical_restored_manifest_denied BEFORE INSERT ON analytical_lineage_manifests FOR EACH ROW EXECUTE FUNCTION aw_analytical_restored_lineage_denied();
--> statement-breakpoint
CREATE TRIGGER analytical_restored_input_denied BEFORE INSERT ON analytical_lineage_edges FOR EACH ROW EXECUTE FUNCTION aw_analytical_restored_lineage_denied();
