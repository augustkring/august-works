CREATE FUNCTION aw_skill_version_source_erased(p_company uuid,p_version uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT aw_learning_asset_erased(p_company,'skill_version',p_version) OR EXISTS(
  SELECT 1 FROM learning_domain_candidates l JOIN learning_hypotheses h ON h.company_id=l.company_id AND h.id=l.hypothesis_id
  WHERE l.company_id=p_company AND l.target_domain='skill' AND l.candidate_id=p_version
  AND (l.erased_at IS NOT NULL OR aw_learning_cycle_erased(p_company,h.cycle_id)))
$$;
--> statement-breakpoint
-- Existing immutable content remains immutable except the exact native C7 marker.
CREATE OR REPLACE FUNCTION aw_v5_guard_skill_version_content() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF aw_skill_version_source_erased(OLD.company_id,OLD.id) THEN
  IF NEW.file_inventory='[]'::jsonb AND NEW.label IS NULL AND NEW.state='rejected' AND NEW.validation_summary='{"erased":true}'::jsonb
   AND (to_jsonb(NEW)-ARRAY['file_inventory','label','state','validation_summary'])=(to_jsonb(OLD)-ARRAY['file_inventory','label','state','validation_summary']) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Skill version content and provenance are immutable' USING ERRCODE='23514',CONSTRAINT='aw_v5_skill_version_immutable';
 END IF;
 IF (NEW.company_id,NEW.company_skill_id,NEW.revision_number,NEW.file_inventory,NEW.author_user_id,NEW.source_playbook_revision_id)
  IS DISTINCT FROM (OLD.company_id,OLD.company_skill_id,OLD.revision_number,OLD.file_inventory,OLD.author_user_id,OLD.source_playbook_revision_id) THEN
  RAISE EXCEPTION 'Skill version content and provenance are immutable' USING ERRCODE='23514',CONSTRAINT='aw_v5_skill_version_immutable';
 END IF;
 IF NEW.author_agent_id IS DISTINCT FROM OLD.author_agent_id AND NOT(NEW.author_agent_id IS NULL AND NOT EXISTS(SELECT 1 FROM agents WHERE id=OLD.author_agent_id)) THEN
  RAISE EXCEPTION 'Skill version author cannot be changed' USING ERRCODE='23514',CONSTRAINT='aw_v5_skill_version_immutable';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_learning_guard_skill_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p_link uuid;
BEGIN
 IF aw_skill_version_source_erased(NEW.company_id,NEW.id) THEN
  NEW.file_inventory='[]';NEW.label=NULL;NEW.validation_summary='{"erased":true}';NEW.state='rejected';
  RETURN NEW;
 END IF;
 FOR p_link IN SELECT id FROM learning_domain_candidates WHERE company_id=NEW.company_id AND target_domain='skill' AND candidate_id=NEW.id
  UNION SELECT candidate_link_id FROM learning_retained_assets WHERE company_id=NEW.company_id AND asset_type='skill_version' AND asset_id=NEW.id LOOP
  IF NEW.state='active' AND NOT aw_learning_link_current(NEW.company_id,p_link) THEN
   RAISE EXCEPTION 'Skill promotion requires current learning evidence' USING ERRCODE='23514';
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
--> statement-breakpoint
-- The original UPDATE guard also fences late inserted native identities.
CREATE TRIGGER aw_learning_skill_version_insert_guard BEFORE INSERT ON company_skill_versions
 FOR EACH ROW EXECUTE FUNCTION aw_learning_guard_skill_version();
--> statement-breakpoint
-- Native Skill version identity owns only its generated snapshot directory.
-- The existing Memory retention outbox performs post-commit filesystem erasure.
CREATE FUNCTION aw_skill_version_file_erasure() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE company uuid; skill uuid; version uuid;
BEGIN
 IF TG_OP='DELETE' THEN
  company:=OLD.company_id;skill:=OLD.company_skill_id;version:=OLD.id;
  PERFORM pg_advisory_xact_lock(hashtextextended('business-events:'||company::text,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('memory:privacy:'||company::text,0));
 ELSE
  company:=NEW.company_id;skill:=NEW.company_skill_id;version:=NEW.id;
  IF NOT aw_skill_version_source_erased(company,version) THEN RETURN NEW; END IF;
 END IF;
 -- A physical company cascade has no remaining native outbox owner.
 IF EXISTS(SELECT 1 FROM companies WHERE id=company) THEN
  INSERT INTO memory_jobs(company_id,operation_type,job_key,source_ref_json)
   VALUES(company,'retention','skill-version-file-erasure:v1:'||version::text,
    jsonb_build_object('kind','skill_version_file_erasure','skillId',skill::text,'versionId',version::text))
   ON CONFLICT(company_id,job_key,attempt_number) DO UPDATE
   SET status='queued',finished_at=NULL,result_json=NULL,result_summary=NULL,error=NULL,error_code=NULL,updated_at=now()
   WHERE memory_jobs.status IN ('succeeded','failed','cancelled');
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aaa_skill_version_file_delete BEFORE DELETE ON company_skill_versions
 FOR EACH ROW EXECUTE FUNCTION aw_skill_version_file_erasure();
--> statement-breakpoint
CREATE TRIGGER skill_version_file_source_erasure AFTER INSERT OR UPDATE ON company_skill_versions
 FOR EACH ROW EXECUTE FUNCTION aw_skill_version_file_erasure();
--> statement-breakpoint
INSERT INTO memory_jobs(company_id,operation_type,job_key,source_ref_json)
 SELECT company_id,'retention','skill-version-file-erasure:v1:'||id::text,
 jsonb_build_object('kind','skill_version_file_erasure','skillId',company_skill_id::text,'versionId',id::text)
 FROM company_skill_versions WHERE aw_skill_version_source_erased(company_id,id)
 ON CONFLICT(company_id,job_key,attempt_number) DO NOTHING;

--> statement-breakpoint
UPDATE company_skill_versions SET file_inventory='[]'::jsonb,label=NULL,state='rejected',validation_summary='{"erased":true}'::jsonb
 WHERE aw_skill_version_source_erased(company_id,id);
