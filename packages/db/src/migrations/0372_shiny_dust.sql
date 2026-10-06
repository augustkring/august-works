CREATE TABLE "agent_package_update_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"installation_id" uuid NOT NULL,
	"proposal" jsonb NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"reviewed_by_user_id" text,
	"accepted_installation_version" integer,
	"erased_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_package_update_proposals_tenant_uq" UNIQUE("company_id","id"),
	CONSTRAINT "agent_package_update_proposals_status_check" CHECK ("agent_package_update_proposals"."status" in ('pending','accepted','rejected','stale'))
);
--> statement-breakpoint
ALTER TABLE "learning_hypotheses" DROP CONSTRAINT "learning_hypothesis_target_check";--> statement-breakpoint
ALTER TABLE "learning_retained_assets" DROP CONSTRAINT "learning_retained_asset_type_check";--> statement-breakpoint
ALTER TABLE "agent_package_update_proposals" ADD CONSTRAINT "agent_package_update_proposals_company_id_installation_id_company_agent_package_installations_company_id_id_fk" FOREIGN KEY ("company_id","installation_id") REFERENCES "public"."company_agent_package_installations"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_hypotheses" ADD CONSTRAINT "learning_hypothesis_target_check" CHECK ("learning_hypotheses"."target_domain" in ('foundation','skill','playbook','project','policy','workflow','role_pack','automation_artifact','agent_package'));--> statement-breakpoint
ALTER TABLE "learning_retained_assets" ADD CONSTRAINT "learning_retained_asset_type_check" CHECK ("learning_retained_assets"."asset_type" in ('document_revision','skill_version','workflow_revision','role_pack_version','automation_artifact_version','agent_package_installation'));--> statement-breakpoint
CREATE FUNCTION aw_v7_package_proposal_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE l learning_domain_candidates;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'package_proposal_tombstone_required' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (NEW.company_id,NEW.installation_id,NEW.created_by_user_id,NEW.created_at) IS DISTINCT FROM (OLD.company_id,OLD.installation_id,OLD.created_by_user_id,OLD.created_at) THEN RAISE EXCEPTION 'package_proposal_scope_immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (NEW.proposal,NEW.reason) IS DISTINCT FROM (OLD.proposal,OLD.reason) AND NEW.erased_at IS NULL THEN RAISE EXCEPTION 'package_proposal_payload_immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO l FROM learning_domain_candidates WHERE company_id=NEW.company_id AND target_domain='agent_package' AND candidate_id=NEW.id;
 IF l.id IS NOT NULL THEN
  IF aw_learning_cycle_erased(NEW.company_id,(SELECT cycle_id FROM learning_hypotheses WHERE company_id=NEW.company_id AND id=l.hypothesis_id)) THEN NEW.proposal:=NULL;NEW.reason:='';NEW.erased_at:=coalesce(NEW.erased_at,now());NEW.status:='stale';
  ELSIF NEW.status='accepted' AND NOT aw_learning_link_current(NEW.company_id,l.id) THEN RAISE EXCEPTION 'package_learning_source_changed' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND OLD.status IN ('accepted','rejected','stale') AND NEW.status='pending' THEN RAISE EXCEPTION 'package_proposal_no_revival' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v7_package_proposal_guard BEFORE UPDATE OR DELETE ON agent_package_update_proposals FOR EACH ROW EXECUTE FUNCTION aw_v7_package_proposal_guard();
--> statement-breakpoint
CREATE FUNCTION aw_v7_learning_package_privacy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c uuid; h uuid; erased boolean;
BEGIN
 c:=NEW.company_id;h:=NEW.hypothesis_id;
 IF NEW.target_domain='agent_package' AND NOT aw_learning_link_current(c,NEW.id) THEN
  erased:=NEW.erased_at IS NOT NULL OR aw_learning_cycle_erased(c,(SELECT cycle_id FROM learning_hypotheses WHERE company_id=c AND id=h));
  UPDATE agent_package_update_proposals SET status='stale',proposal=CASE WHEN erased THEN NULL ELSE proposal END,reason=CASE WHEN erased THEN '' ELSE reason END,erased_at=CASE WHEN erased THEN coalesce(erased_at,now()) ELSE erased_at END,updated_at=now() WHERE company_id=c AND id=NEW.candidate_id;
  UPDATE company_agent_package_installations SET status='degraded',activation_hash=NULL,readiness=NULL,version=version+1,updated_at=now() WHERE company_id=c AND id=NEW.target_id AND status NOT IN ('uninstalled','suspended') AND EXISTS(SELECT 1 FROM learning_retained_assets a WHERE a.company_id=c AND a.candidate_link_id=NEW.id AND a.asset_type='agent_package_installation' AND a.asset_id=NEW.target_id);
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v7_learning_package_privacy AFTER INSERT OR UPDATE ON learning_domain_candidates FOR EACH ROW EXECUTE FUNCTION aw_v7_learning_package_privacy();
--> statement-breakpoint
CREATE FUNCTION aw_v7_package_proposal_content_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE l learning_domain_candidates;
BEGIN
 SELECT * INTO l FROM learning_domain_candidates WHERE company_id=NEW.company_id AND target_domain='agent_package' AND candidate_id=NEW.id;
 IF l.id IS NOT NULL AND (l.erased_at IS NOT NULL OR aw_learning_cycle_erased(NEW.company_id,(SELECT cycle_id FROM learning_hypotheses WHERE company_id=NEW.company_id AND id=l.hypothesis_id))) THEN NEW.proposal:=NULL;NEW.reason:='';NEW.erased_at:=coalesce(NEW.erased_at,now());NEW.status:='stale'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aaa_v7_package_proposal_content_guard BEFORE INSERT OR UPDATE ON agent_package_update_proposals FOR EACH ROW EXECUTE FUNCTION aw_v7_package_proposal_content_guard();
