-- Reuse original Learning proposal Source guard; remove every erased draft change.
CREATE OR REPLACE FUNCTION aw_learning_guard_proposal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE l learning_domain_candidates%ROWTYPE; body jsonb;
BEGIN
 FOR l IN SELECT * FROM learning_domain_candidates WHERE company_id=NEW.company_id AND target_domain=TG_ARGV[0] AND candidate_id=NEW.id
 UNION SELECT c.* FROM learning_retained_assets a JOIN learning_domain_candidates c ON c.company_id=a.company_id AND c.id=a.candidate_link_id
 WHERE TG_ARGV[0]='playbook' AND a.company_id=NEW.company_id AND a.asset_type='skill_version'
 AND a.asset_id=(to_jsonb(NEW)->>'source_skill_version_id')::uuid LOOP
 IF NEW.status='accepted' AND OLD.status IS DISTINCT FROM 'accepted' AND NOT aw_learning_link_current(NEW.company_id,l.id) THEN
 RAISE EXCEPTION 'Learning source evidence is no longer current' USING ERRCODE='23514'; END IF;
 IF l.erased_at IS NOT NULL THEN
   IF TG_ARGV[0]='foundation' THEN NEW.proposed_body=''; NEW.reason=NULL; NEW.change_summary=NULL;
   ELSIF TG_ARGV[0]='playbook' THEN NEW.title='Erased learning proposal'; NEW.markdown=''; NEW.reason='Erased'; NEW.review_rationale=NULL;
   ELSIF TG_ARGV[0]='policy' THEN NEW.proposal=NULL; NEW.reason=''; NEW.review_rationale=NULL;
   ELSIF TG_ARGV[0]='project' THEN NEW.reason='Erased learning evidence'; NEW.review_rationale=NULL;
     NEW.patch_json=jsonb_set(jsonb_set(jsonb_set(NEW.patch_json,'{reason}','"Erased learning evidence"'),'{evidence}','[]'),'{changes}','[]');
   END IF;
 END IF;
 -- Domain acceptance creates a reviewed draft; retain the new revision's root lineage.
 IF NEW.status='accepted' AND OLD.status IS DISTINCT FROM 'accepted' AND TG_ARGV[0] IN ('foundation','playbook') THEN
   INSERT INTO learning_retained_assets(company_id,candidate_link_id,asset_type,asset_id)
   SELECT NEW.company_id,l.id,'document_revision',d.latest_revision_id FROM documents d
   WHERE d.company_id=NEW.company_id AND d.id=(CASE WHEN TG_ARGV[0]='foundation' THEN
     (SELECT document_id FROM foundation_documents WHERE company_id=NEW.company_id AND id=l.target_id) ELSE
     (SELECT document_id FROM playbook_documents WHERE company_id=NEW.company_id AND id=(to_jsonb(NEW)->>'playbook_id')::uuid) END)
   AND d.latest_revision_id IS NOT NULL ON CONFLICT DO NOTHING;
 END IF;
 END LOOP;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_learning_project_proposal_insert BEFORE INSERT ON project_roadmap_proposals FOR EACH ROW EXECUTE FUNCTION aw_learning_guard_proposal('project');
--> statement-breakpoint
CREATE TRIGGER aw_learning_policy_proposal_insert BEFORE INSERT ON policy_change_proposals FOR EACH ROW EXECUTE FUNCTION aw_learning_guard_proposal('policy');
--> statement-breakpoint
-- Reconcile previously erased owned proposals without touching applied canonical Tasks.
UPDATE project_roadmap_proposals p SET patch_json=p.patch_json
 WHERE EXISTS(SELECT 1 FROM learning_domain_candidates l WHERE l.company_id=p.company_id AND l.target_domain='project' AND l.candidate_id=p.id AND l.erased_at IS NOT NULL);
