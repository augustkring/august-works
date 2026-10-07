-- Extend the existing native version inheritance owner; do not create a new Source ledger.
CREATE OR REPLACE FUNCTION aw_learning_inherit_native_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_id uuid; native_type text; l learning_retained_assets%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='workflow_revisions' THEN
   native_type:='workflow_revision';
   FOR l IN SELECT a.* FROM learning_retained_assets a JOIN workflows w ON w.company_id=a.company_id AND (a.asset_id=w.draft_revision_id OR a.asset_id=w.published_revision_id)
    WHERE w.company_id=NEW.company_id AND w.id=NEW.workflow_id AND a.asset_type=native_type LOOP
     IF NOT aw_learning_link_current(NEW.company_id,l.candidate_link_id) THEN RAISE EXCEPTION 'Workflow Learning source changed' USING ERRCODE='23514'; END IF;
     INSERT INTO learning_retained_assets(company_id,candidate_link_id,asset_type,asset_id) VALUES(NEW.company_id,l.candidate_link_id,native_type,NEW.id) ON CONFLICT DO NOTHING;
   END LOOP;
 ELSIF TG_TABLE_NAME='automation_artifact_versions' THEN
   native_type:='automation_artifact_version';
   SELECT latest_version_id INTO parent_id FROM automation_artifacts WHERE company_id=NEW.company_id AND id=NEW.artifact_id;
   IF (SELECT count(*) FROM learning_retained_assets WHERE company_id=NEW.company_id AND asset_id=parent_id AND asset_type=native_type)>20 THEN
     RAISE EXCEPTION 'Artifact Learning lineage exceeds its complete-set bound' USING ERRCODE='23514';
   END IF;
   FOR l IN SELECT * FROM learning_retained_assets WHERE company_id=NEW.company_id AND asset_id=parent_id AND asset_type=native_type LOOP
     IF NOT aw_learning_link_current(NEW.company_id,l.candidate_link_id) THEN RAISE EXCEPTION 'Artifact Learning source changed' USING ERRCODE='23514'; END IF;
     INSERT INTO learning_retained_assets(company_id,candidate_link_id,asset_type,asset_id) VALUES(NEW.company_id,l.candidate_link_id,native_type,NEW.id) ON CONFLICT DO NOTHING;
   END LOOP;
 ELSE
   native_type:='role_pack_version';
   SELECT published_version_id INTO parent_id FROM role_packs WHERE company_id=NEW.company_id AND id=NEW.role_pack_id;
   FOR l IN SELECT * FROM learning_retained_assets WHERE company_id=NEW.company_id AND asset_id=parent_id AND asset_type=native_type LOOP
     IF NOT aw_learning_link_current(NEW.company_id,l.candidate_link_id) THEN RAISE EXCEPTION 'Role Pack Learning source changed' USING ERRCODE='23514'; END IF;
     INSERT INTO learning_retained_assets(company_id,candidate_link_id,asset_type,asset_id) VALUES(NEW.company_id,l.candidate_link_id,native_type,NEW.id) ON CONFLICT DO NOTHING;
   END LOOP;
 END IF;
 RETURN NEW;
END $$;

--> statement-breakpoint
-- Inherit before the existing immutable payload/privacy guards inspect a new version.
CREATE TRIGGER aaa_learning_artifact_inheritance BEFORE INSERT ON automation_artifact_versions FOR EACH ROW EXECUTE FUNCTION aw_learning_inherit_native_version();
