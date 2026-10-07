-- Original V8 sources supplement the existing V7 Learning outcome/eval owner.
CREATE OR REPLACE FUNCTION aw_learning_cycle_erased(p_company uuid,p_cycle uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM learning_cycles c WHERE c.company_id=p_company AND c.id=p_cycle AND
  (c.erased_at IS NOT NULL OR (c.analytical_source_count>0 AND
   (c.analytical_source_expires_at<=now() OR c.analytical_source_count<>(SELECT count(*) FROM learning_analytical_dependencies d WHERE d.company_id=c.company_id AND d.cycle_id=c.id)
    OR EXISTS(SELECT 1 FROM learning_analytical_dependencies d JOIN analytical_lineage_manifests m ON m.company_id=d.company_id AND m.id=d.source_manifest_id WHERE d.company_id=c.company_id AND d.cycle_id=c.id AND
     (m.expires_at<=now() OR EXISTS(SELECT 1 FROM memory_deletion_markers x WHERE x.company_id=d.company_id AND x.kind='source' AND x.key=encode(sha256(convert_to(format('["%s","source",["august_works_analytical","manifest://%s"]]',d.company_id,d.source_manifest_id),'UTF8')),'hex'))))))))
 OR EXISTS(SELECT 1 FROM learning_evidence e JOIN memory_records m ON m.company_id=e.company_id AND m.id=e.memory_record_id
  WHERE e.company_id=p_company AND e.cycle_id=p_cycle AND(m.deleted_at IS NOT NULL OR EXISTS(SELECT 1 FROM memory_deletion_markers d WHERE d.company_id=m.company_id AND d.record_id=m.id)))
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_learning_link_current(p_company uuid, p_link uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS (SELECT 1 FROM learning_domain_candidates l
 JOIN learning_hypotheses h ON h.company_id=l.company_id AND h.id=l.hypothesis_id
 JOIN learning_cycles c ON c.company_id=h.company_id AND c.id=h.cycle_id
 JOIN learning_evaluations e ON e.company_id=l.company_id AND e.id=l.evaluation_id
 WHERE l.company_id=p_company AND l.id=p_link AND l.invalidated_at IS NULL AND l.erased_at IS NULL
 AND NOT aw_learning_cycle_erased(c.company_id,c.id) AND c.erased_at IS NULL AND c.status NOT IN ('failed','cancelled') AND h.erased_at IS NULL AND e.erased_at IS NULL AND e.result='passed'
 AND EXISTS (SELECT 1 FROM learning_evidence r WHERE r.company_id=c.company_id AND r.cycle_id=c.id)
 AND NOT EXISTS (SELECT 1 FROM learning_evidence r LEFT JOIN memory_records m ON m.company_id=r.company_id AND m.id=r.memory_record_id
 WHERE r.company_id=c.company_id AND r.cycle_id=c.id AND (m.id IS NULL OR date_trunc('milliseconds',m.updated_at)<>r.source_version::timestamptz
 OR m.review_state<>'accepted' OR m.retention_state<>'active' OR m.deleted_at IS NOT NULL OR m.revoked_at IS NOT NULL OR m.superseded_by_record_id IS NOT NULL
 OR m.owner_agent_id IS NOT NULL OR m.scope_type<>c.scope_type OR m.scope_id IS DISTINCT FROM c.scope_id
 OR m.valid_from>now() OR m.valid_until<=now() OR m.expires_at<=now()
 OR (jsonb_typeof(m.metadata->'allowedPurposes')='array' AND NOT (m.metadata->'allowedPurposes' ? c.purpose))
 OR EXISTS (SELECT 1 FROM memory_deletion_markers d WHERE d.company_id=m.company_id AND d.record_id=m.id)))
 AND EXISTS (SELECT 1 FROM jsonb_each_text(e.outcome_versions))
 AND NOT EXISTS (SELECT 1 FROM jsonb_each_text(e.outcome_versions) v LEFT JOIN issues i ON i.company_id=e.company_id AND i.id=v.key::uuid
 WHERE i.id IS NULL OR i.status<>'done' OR i.completed_at IS NULL OR date_trunc('milliseconds',i.updated_at)<>v.value::timestamptz
 OR (c.scope_type='project' AND i.project_id::text IS DISTINCT FROM c.scope_id)))
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_learning_guard_payload() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p_cycle uuid;
BEGIN
 IF TG_TABLE_NAME='learning_cycles' THEN p_cycle=NEW.id;
 ELSIF TG_TABLE_NAME='learning_hypotheses' THEN p_cycle=NEW.cycle_id;
 ELSE SELECT cycle_id INTO p_cycle FROM learning_hypotheses WHERE company_id=NEW.company_id AND id=NEW.hypothesis_id;
 END IF;
 IF aw_learning_cycle_erased(NEW.company_id,p_cycle) THEN
   NEW.erased_at=coalesce(OLD.erased_at,now());
   IF TG_TABLE_NAME='learning_cycles' THEN NEW.trigger=''; NEW.purpose='erased'; NEW.status='cancelled'; NEW.outcome_versions='{}'; NEW.analytical_source_pins='[]'; NEW.analytical_source_count=0; NEW.analytical_source_expires_at=NULL;
   ELSIF TG_TABLE_NAME='learning_hypotheses' THEN NEW.claim=''; NEW.predicted_effect=''; NEW.evaluation_contract=NULL; NEW.status='rejected';
   ELSE NEW.cases='[]'; NEW.metrics='{}'; NEW.outcome_versions='{}'; NEW.limitations='[]'; NEW.reviewed_by='erased';
   END IF;
 END IF; RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_learning_hypothesis_insert_erasure BEFORE INSERT ON learning_hypotheses FOR EACH ROW EXECUTE FUNCTION aw_learning_guard_payload();
--> statement-breakpoint
CREATE TRIGGER aw_learning_evaluation_insert_erasure BEFORE INSERT ON learning_evaluations FOR EACH ROW EXECUTE FUNCTION aw_learning_guard_payload();
--> statement-breakpoint
CREATE FUNCTION aw_learning_analytical_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tenant uuid; cycle uuid; root learning_cycles%ROWTYPE;
BEGIN
 tenant=NEW.company_id; IF TG_TABLE_NAME='learning_cycles' THEN cycle=NEW.id; ELSE cycle=NEW.cycle_id; END IF;
 SELECT * INTO root FROM learning_cycles WHERE company_id=tenant AND id=cycle;
 IF NOT FOUND OR root.erased_at IS NOT NULL THEN RETURN NEW; END IF;
 IF root.analytical_source_count<>(SELECT count(*) FROM learning_analytical_dependencies WHERE company_id=tenant AND cycle_id=cycle)
  OR EXISTS(SELECT 1 FROM learning_analytical_dependencies d JOIN analytical_lineage_manifests m ON m.company_id=d.company_id AND m.id=d.source_manifest_id WHERE d.company_id=tenant AND d.cycle_id=cycle AND m.expires_at<root.analytical_source_expires_at)
  OR aw_learning_cycle_erased(tenant,cycle) THEN
  RAISE EXCEPTION 'Complete original Learning analytical sources required' USING ERRCODE='23514',CONSTRAINT='learning_analytical_sources_complete';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER learning_cycle_analytical_complete AFTER INSERT ON learning_cycles DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION aw_learning_analytical_complete();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER learning_dependency_analytical_complete AFTER INSERT ON learning_analytical_dependencies DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION aw_learning_analytical_complete();
--> statement-breakpoint
CREATE FUNCTION aw_learning_analytical_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='learning_analytical_dependencies' THEN RAISE EXCEPTION 'Learning analytical dependencies are immutable' USING ERRCODE='23514'; END IF;
 IF OLD.erased_at IS NOT NULL AND NEW.erased_at IS NULL THEN RAISE EXCEPTION 'Erased Learning cannot be restored' USING ERRCODE='23514'; END IF;
 IF NEW.erased_at IS NULL AND ROW(NEW.company_id,NEW.id,NEW.analytical_source_pins,NEW.analytical_source_count,NEW.analytical_source_expires_at)
  IS DISTINCT FROM ROW(OLD.company_id,OLD.id,OLD.analytical_source_pins,OLD.analytical_source_count,OLD.analytical_source_expires_at) THEN
  RAISE EXCEPTION 'Learning analytical source pins are immutable' USING ERRCODE='23514';
 END IF; RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER learning_cycle_analytical_immutable BEFORE UPDATE ON learning_cycles FOR EACH ROW EXECUTE FUNCTION aw_learning_analytical_immutable();
--> statement-breakpoint
CREATE TRIGGER learning_dependency_analytical_immutable BEFORE UPDATE ON learning_analytical_dependencies FOR EACH ROW EXECUTE FUNCTION aw_learning_analytical_immutable();
--> statement-breakpoint
CREATE FUNCTION aw_learning_analytical_source_erased() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE learning_cycles SET erased_at=coalesce(erased_at,clock_timestamp()),updated_at=clock_timestamp() WHERE company_id=OLD.company_id AND id=OLD.cycle_id;
 RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER learning_analytical_source_erased AFTER DELETE ON learning_analytical_dependencies FOR EACH ROW EXECUTE FUNCTION aw_learning_analytical_source_erased();
--> statement-breakpoint
CREATE FUNCTION aw_learning_analytical_erasure_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.analytical_source_count=0 OR OLD.erased_at IS NOT NULL OR NEW.erased_at IS NULL THEN RETURN NEW; END IF;
 UPDATE learning_hypotheses SET updated_at=clock_timestamp() WHERE company_id=NEW.company_id AND cycle_id=NEW.id;
 UPDATE learning_evaluations SET metrics='{}' WHERE company_id=NEW.company_id AND hypothesis_id IN(SELECT id FROM learning_hypotheses WHERE company_id=NEW.company_id AND cycle_id=NEW.id);
 UPDATE learning_domain_candidates SET invalidated_at=coalesce(invalidated_at,clock_timestamp()),erased_at=coalesce(erased_at,clock_timestamp()) WHERE company_id=NEW.company_id AND hypothesis_id IN(SELECT id FROM learning_hypotheses WHERE company_id=NEW.company_id AND cycle_id=NEW.id);
 UPDATE learning_retained_assets SET erased_at=coalesce(erased_at,clock_timestamp()) WHERE company_id=NEW.company_id AND candidate_link_id IN(SELECT l.id FROM learning_domain_candidates l JOIN learning_hypotheses h ON h.company_id=l.company_id AND h.id=l.hypothesis_id WHERE l.company_id=NEW.company_id AND h.cycle_id=NEW.id);
 IF NOT EXISTS(SELECT 1 FROM companies WHERE id=NEW.company_id) THEN RETURN NEW; END IF;
 INSERT INTO memory_jobs(company_id,operation_type,job_key,source_ref_json) VALUES(NEW.company_id,'retention','learning-analytical-erasure:v1:'||NEW.id,jsonb_build_object('kind','learning_analytical_erasure','cycleId',NEW.id))
 ON CONFLICT(company_id,job_key,attempt_number) DO UPDATE SET status='queued',execution_owner_id=NULL,lease_expires_at=NULL,finished_at=NULL,result_json=NULL,result_summary=NULL,error=NULL,error_code=NULL,updated_at=clock_timestamp() WHERE memory_jobs.status IN('succeeded','failed','cancelled');
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER learning_analytical_erasure_outbox AFTER UPDATE ON learning_cycles FOR EACH ROW EXECUTE FUNCTION aw_learning_analytical_erasure_outbox();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_analytical_manifest_source_deleted(tenant uuid, source uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE dependency analytical_context_dependencies%ROWTYPE;
BEGIN
 IF source IS NULL OR NOT EXISTS(SELECT 1 FROM companies WHERE id=tenant) THEN RETURN; END IF;
 INSERT INTO memory_deletion_markers(company_id,key,kind,deleted_at)
 VALUES(tenant,encode(sha256(convert_to(format('["%s","source",["august_works_analytical","manifest://%s"]]',tenant,source),'UTF8')),'hex'),'source',clock_timestamp()) ON CONFLICT DO NOTHING;
 UPDATE learning_cycles SET erased_at=coalesce(erased_at,clock_timestamp()),updated_at=clock_timestamp() WHERE company_id=tenant AND id IN(SELECT cycle_id FROM learning_analytical_dependencies WHERE company_id=tenant AND source_manifest_id=source);
 FOR dependency IN SELECT * FROM analytical_context_dependencies WHERE company_id=tenant AND source_manifest_id=source LOOP
  INSERT INTO memory_deletion_markers(company_id,key,kind,record_id,deleted_at)
   SELECT company_id,deletion_key,'record',memory_record_id,clock_timestamp() FROM analytical_context_roots WHERE company_id=tenant AND memory_record_id=dependency.memory_record_id ON CONFLICT DO NOTHING;
  UPDATE memory_records SET content='',title=NULL,summary=NULL,subject_type=NULL,subject_id=NULL,metadata='{}',deleted_at=coalesce(deleted_at,clock_timestamp()),updated_at=clock_timestamp(),retention_state='expired',review_state='rejected'
   WHERE company_id=tenant AND id=dependency.memory_record_id;
 END LOOP;
END $$;
